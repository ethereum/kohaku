use std::{collections::HashMap, sync::Arc};

use alloy::{
    primitives::{Address, B128, Bytes, ChainId, U256},
    sol_types::SolCall,
};
use eth_rpc::{EthRpcClient, EthRpcClientError};
use prover::Prover;
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info};
use userop_kit::{
    BundlerError, BundlerProvider, UserOperation, UserOperationBuilder,
    railgun::sign_railgun_authorization,
};

use crate::{
    abis::railgun::RailgunSmartWallet,
    caip::AssetId,
    chain_config::{ChainConfig, get_chain_config},
    railgun::{
        address::RailgunAddress,
        indexer::{NoteSyncer, TransactionSyncer, UtxoIndexer, UtxoIndexerError, UtxoIndexerState},
        merkle_tree::SmartWalletUtxoVerifier,
        note::{Note, utxo::UtxoNote},
        poi::{PoiProvider, PoiProviderError},
        signer::Signer,
        transaction::{
            ProvedOperation, ProvedTx, ShieldBuilder, TransactionBuilder, TransactionBuilderError,
        },
    },
};

/// Interfaces with the RAILGUN protocol.
pub struct RailgunProvider {
    chain: ChainConfig,
    utxo_indexer: UtxoIndexer,
    prover: Arc<dyn Prover>,

    poi_provider: Option<PoiProvider>,
}

#[derive(Serialize, Deserialize)]
pub struct RailgunProviderState {
    pub chain_id: ChainId,
    pub indexer: UtxoIndexerState,
}

#[derive(Debug, Error)]
pub enum RailgunProviderError {
    #[error("Unsupported chain ID: {0}")]
    UnsupportedChainId(ChainId),
    #[error("Utxo indexer error: {0}")]
    UtxoIndexer(#[from] UtxoIndexerError),
    #[error("Build error: {0}")]
    Build(#[from] TransactionBuilderError),
    #[error("POI provider error: {0}")]
    PoiProvider(#[from] PoiProviderError),
    #[error("Unable to construct valid note configuration for fee payment")]
    FeeNoteNotFound,
    #[error("Signer Error: {0}")]
    Signer(#[from] alloy::signers::Error),
    #[error("Bundler error: {0}")]
    Bundler(#[from] BundlerError),
    #[error("RPC error: {0}")]
    Rpc(#[from] EthRpcClientError),
}

/// General provider functions
impl RailgunProvider {
    pub fn new(
        chain: ChainConfig,
        provider: Arc<dyn EthRpcClient>,
        utxo_syncer: Arc<dyn NoteSyncer>,
        prover: Arc<dyn Prover>,
    ) -> Self {
        let utxo_verifier = Arc::new(SmartWalletUtxoVerifier::new(
            chain.railgun_smart_wallet,
            provider.clone(),
        ));

        Self {
            chain,
            utxo_indexer: UtxoIndexer::new(utxo_syncer, utxo_verifier),
            prover,
            poi_provider: None,
        }
    }

    pub fn with_poi(&mut self, txid_syncer: Arc<dyn TransactionSyncer>) {
        let poi_provider = PoiProvider::new(
            self.chain.id,
            self.chain.poi_endpoint,
            self.chain.list_keys(),
            self.prover.clone(),
            txid_syncer,
        );
        self.poi_provider = Some(poi_provider);
    }

    pub fn set_state(&mut self, state: RailgunProviderState) -> Result<(), RailgunProviderError> {
        self.chain = get_chain_config(state.chain_id)
            .ok_or(RailgunProviderError::UnsupportedChainId(state.chain_id))?;
        self.utxo_indexer.set_state(state.indexer);
        Ok(())
    }

    /// Returns the provider's state as a serialized state object. Used to save state for
    /// future restoration.
    ///
    /// State does NOT include registered accounts. Accounts must be re-registered
    /// each time a provider is created.
    pub fn state(&self) -> RailgunProviderState {
        RailgunProviderState {
            chain_id: self.chain.id,
            indexer: self.utxo_indexer.state(),
        }
    }

    /// Register an account with the provider. The provider will index the account's
    /// transactions and balance as it syncs.
    ///
    /// Providers will NOT save registered accounts in their state. Accounts
    /// must be re-registered each time a provider is created.
    pub fn register(&mut self, account: Arc<dyn Signer>) {
        self.utxo_indexer.register(account);
    }

    /// Registers an account starting from a specific block.
    pub fn register_from(&mut self, account: Arc<dyn Signer>, from_block: u64) {
        self.utxo_indexer.register_from(account, from_block);
    }

    /// Returns the balance for the given address.
    ///
    /// If a POI provider is configured, only returns the spendable balance
    /// according to the POI provider.
    pub async fn balance(&mut self, address: RailgunAddress) -> HashMap<AssetId, u128> {
        let unspent = self.unspent(address).await;

        let mut balance_map = HashMap::new();
        for note in unspent {
            let asset = note.asset();
            let value = note.value();
            *balance_map.entry(asset).or_insert(0) += value;
        }

        balance_map
    }

    /// Helper to create a shield builder
    pub fn shield(&self) -> ShieldBuilder {
        ShieldBuilder::new(self.chain)
    }

    /// Helper to create a transaction builder
    pub fn transact(&self) -> TransactionBuilder {
        TransactionBuilder::new()
    }

    /// Build a executable transaction from a transaction builder
    pub async fn build<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<ProvedTx, RailgunProviderError> {
        let operations = self.build_operation(builder, rng).await?;
        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.register_ops(&operations).await;
        }

        let proved_tx = ProvedTx::new(self.chain.railgun_smart_wallet, operations);
        Ok(proved_tx)
    }

    /// Build a transaction from a transaction builder into a broadcastable 4337 UserOp.
    pub async fn prepare_broadcast<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        provider: &impl EthRpcClient,
        sender: &impl alloy::signers::Signer,
        bundler: &impl BundlerProvider,
        fee_payer: Arc<dyn Signer>,
        fee_recipient: RailgunAddress,
        fee_token: Address,
        rng: &mut R,
    ) -> Result<UserOperation, RailgunProviderError> {
        let fee_asset = AssetId::Erc20(fee_token);

        // 7702 authorization
        let nonce = provider
            .get_transaction_count(sender.address(), None)
            .await?;
        info!(
            "Signing 7702 authorization for sender: {:?}, nonce: {}",
            sender.address(),
            nonce
        );
        let auth = sign_railgun_authorization(sender, self.chain.id, nonce).await?;

        //? Initial arbitrary estimation of fee note value.
        //? IMPORTANT: Needs to be high enough to not cause a revert. Most
        //? bundlers seem to use a fixed maxCost value for estimation (IE 27_000_000
        //? for pimlico). Setting this too low causes an unrecoverable estimation
        //? failure.
        let mut fee_value = 100_000_000;

        info!("Fetching max fee per gas from bundler");
        let max_fee_per_gas = bundler.suggest_max_fee_per_gas().await?;

        info!("Iteratively building UserOperation to converge on accurate fee estimate");
        let mut userop_builder =
            UserOperationBuilder::new_railgun(Bytes::new(), B128::ZERO, Address::ZERO, 0);

        for _ in 0..5 {
            let broadcast_builder = builder.clone().transfer(
                fee_payer.clone(),
                fee_recipient,
                fee_asset,
                fee_value,
                "fee",
            );
            info!(
                "Building broadcast transaction with fee value: {}",
                fee_value
            );
            let mut operations = self.build_operation(broadcast_builder, rng).await?;

            // Remove the fee note from the operations
            let fee_operation = take_fee_operation(&mut operations, fee_asset, fee_value)?;
            let fee_note = get_fee_note(&fee_operation, fee_asset, fee_value)?;

            // Construct UserOp Calldata
            let fee_calldata: Bytes = RailgunSmartWallet::transactCall {
                _transactions: vec![fee_operation.transaction],
            }
            .abi_encode()
            .into();

            // TODO: Consider removing tail calls if there are no additional operations.
            let tail_call = userop_kit::abis::privacy_account::IPrivacyAccount::Call {
                target: self.chain.railgun_smart_wallet,
                data: RailgunSmartWallet::transactCall {
                    _transactions: operations.into_iter().map(|op| op.transaction).collect(),
                }
                .abi_encode()
                .into(),
            };

            // Construct UserOperation
            userop_builder = UserOperationBuilder::new_railgun(
                fee_calldata.clone(),
                fee_note.random().into(),
                fee_token,
                fee_value,
            )
            .with_sender(sender.address())
            .with_nonce(U256::from(nonce))
            .with_tail_calls(vec![tail_call])
            .with_authorization(auth.clone());

            // Estimate gas
            //
            // Does need a signed 7702 authorization to set account code.
            // Doesn't need a 4337 signature since the bundler ignores `SIG_VALIDATION_FAILED`
            info!("Estimating gas for UserOperation");
            let (estimate, _, _) = userop_builder.estimate_gas(bundler).await?;
            let total_gas: u128 = estimate.sum().saturating_to();
            let new_fee = total_gas * max_fee_per_gas;
            let new_fee = (new_fee * 12) / 10;

            let delta = new_fee.abs_diff(fee_value);
            fee_value = new_fee;

            if delta <= new_fee / 100 {
                // 1% tolerance
                info!("Fee converged at {}", new_fee);
                break;
            }
            info!("Fee updated to {}, delta: {}", new_fee, delta);
        }

        // The bundler binary-searches to the exact minimum call_gas_limit with
        // no margin. The Railgun smart wallet is a proxy, so the execution
        // path has an extra CALL level subject to the 63/64 EVM stipend rule.
        // Add 20% headroom so the implementation doesn't sporadically OOG.
        userop_builder.op.call_gas_limit = userop_builder.op.call_gas_limit * 12 / 10;

        let op = userop_builder.build(sender, bundler).await?;
        Ok(op)
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync_to(block_number).await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync_to(block_number).await?;
        }

        Ok(())
    }

    pub async fn sync(&mut self) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync().await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync().await?;
        }

        Ok(())
    }

    pub fn reset_indexer(&mut self) {
        self.utxo_indexer.reset();

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.reset();
        }
    }

    async fn all_unspent(&mut self) -> Vec<UtxoNote> {
        let addresses = self.utxo_indexer.registered();
        let mut all_notes = Vec::new();

        for address in addresses {
            let mut notes = self.unspent(address).await;
            all_notes.append(&mut notes);
        }
        all_notes
    }

    async fn unspent(&mut self, address: RailgunAddress) -> Vec<UtxoNote> {
        let notes = self.utxo_indexer.unspent(address);

        let Some(poi_provider) = &mut self.poi_provider else {
            return notes;
        };

        let mut spendable_notes = Vec::new();
        for note in notes {
            let spendable = poi_provider.spendable(note.blinded_commitment.into()).await;
            match spendable {
                Ok(true) => spendable_notes.push(note),
                Ok(false) => continue, //? Not spendable, skip
                Err(e) => {
                    //? If there's an error checking POI, log it and skip the note
                    error!("Error checking POI for note {:?}: {}", note, e);
                    continue;
                }
            }
        }

        spendable_notes
    }
}

/// Takes the operation containing the fee note, removing it from the provided operations vector.
fn take_fee_operation(
    operations: &mut Vec<ProvedOperation>,
    fee_asset: AssetId,
    fee_value: u128,
) -> Result<ProvedOperation, RailgunProviderError> {
    let Some(fee_note_pos) = operations.iter().position(|o| {
        o.inner
            .out_notes()
            .iter()
            .any(|n| is_fee_note(n, fee_asset, fee_value))
    }) else {
        return Err(RailgunProviderError::FeeNoteNotFound);
    };
    Ok(operations.remove(fee_note_pos))
}

/// Gets the fee note from the operation
fn get_fee_note(
    operation: &ProvedOperation,
    fee_asset: AssetId,
    fee_value: u128,
) -> Result<Box<dyn Note>, RailgunProviderError> {
    operation
        .inner
        .out_notes()
        .into_iter()
        .find(|n| is_fee_note(n, fee_asset, fee_value))
        .ok_or(RailgunProviderError::FeeNoteNotFound)
}

fn is_fee_note(note: &Box<dyn Note>, fee_asset: AssetId, fee_value: u128) -> bool {
    note.asset() == fee_asset && note.value() == fee_value && note.memo() == "fee"
}

impl RailgunProvider {
    async fn build_operation<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<Vec<ProvedOperation>, RailgunProviderError> {
        let in_notes = self.all_unspent().await;
        let operations = builder
            .build(
                self.prover.as_ref(),
                self.chain.id,
                &in_notes,
                &self.utxo_indexer.utxo_trees,
                rng,
            )
            .await?;

        Ok(operations)
    }
}
