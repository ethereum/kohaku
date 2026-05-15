use std::{collections::HashMap, sync::Arc};

use alloy::{
    primitives::{Address, Bytes},
    sol_types::SolCall,
};
use eip_1193_provider::{Eip1193Error, Eip1193Provider};
use rand::Rng;
use thiserror::Error;
use tracing::{info, warn};
use userop_kit::{
    UserOperation, UserOperationBuilder,
    bundler::{BundlerError, BundlerProvider},
    railgun::{PAYMASTER_MASTER_PUBLIC_KEY, PAYMASTER_VIEWING_PUBLIC_KEY},
};

use crate::{
    abis::railgun::RailgunSmartWallet,
    account::{address::RailgunAddress, signer::RailgunSigner},
    caip::AssetId,
    chain_config::ChainConfig,
    circuit::{groth16_prover::Groth16Prover, prover::Prover},
    crypto::keys::{ByteKey, MasterPublicKey, ViewingPublicKey},
    database::{Database, DatabaseError},
    indexer::{NoteSyncer, TransactionSyncer, UtxoIndexer, UtxoIndexerError},
    merkle_tree::SmartWalletUtxoVerifier,
    note::{Note, utxo::UtxoNote},
    poi::{PoiProvider, PoiProviderError},
    transaction::{
        ProvedOperation, ProvedTx, ShieldBuilder, TransactionBuilder, TransactionBuilderError,
    },
};

/// Interfaces with the RAILGUN protocol.
pub struct RailgunProvider<P: Prover = Groth16Prover> {
    chain: ChainConfig,
    db: Arc<dyn Database>,
    provider: Arc<dyn Eip1193Provider>,
    utxo_indexer: UtxoIndexer,
    prover: P,
    poi_provider: Option<PoiProvider>,
    bundler: Option<Arc<dyn BundlerProvider>>,
}

#[derive(Debug, Error)]
pub enum RailgunProviderError {
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
    #[error("No bundler provider configured")]
    NoBundler,
    #[error("Bundler error: {0}")]
    Bundler(#[from] BundlerError),
    #[error("RPC error: {0}")]
    Rpc(#[from] Eip1193Error),
    #[error("Database error: {0}")]
    Database(#[from] DatabaseError),
}

/// General provider functions
impl<P: Prover> RailgunProvider<P> {
    pub async fn new(
        chain: ChainConfig,
        db: Arc<dyn Database>,
        provider: Arc<dyn Eip1193Provider>,
        utxo_syncer: Arc<dyn NoteSyncer>,
        prover: P,
    ) -> Result<Self, RailgunProviderError> {
        let utxo_verifier = Arc::new(SmartWalletUtxoVerifier::new(
            chain.railgun_smart_wallet,
            provider.clone(),
        ));

        let utxo_indexer = UtxoIndexer::new(db.clone(), utxo_syncer, utxo_verifier).await?;

        Ok(Self {
            chain,
            db,
            provider,
            utxo_indexer,
            prover,
            poi_provider: None,
            bundler: None,
        })
    }

    pub async fn set_poi(
        &mut self,
        txid_syncer: Arc<dyn TransactionSyncer>,
    ) -> Result<(), RailgunProviderError> {
        let poi_provider = PoiProvider::new(
            self.chain.id,
            self.db.clone(),
            self.chain.poi_endpoint.clone(),
            self.chain.list_keys.clone(),
            txid_syncer,
        )
        .await?;
        self.poi_provider = Some(poi_provider);
        Ok(())
    }

    pub fn set_bundler(&mut self, bundler: Arc<dyn BundlerProvider>) {
        self.bundler = Some(bundler);
    }

    /// Register an account with the provider. The provider will index the account's
    /// transactions and balance as it syncs.
    pub async fn register(
        &mut self,
        account: Arc<dyn RailgunSigner>,
    ) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.register(account).await?;
        Ok(())
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
        ShieldBuilder::new(self.chain.clone())
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

    /// Build a transaction from a transaction builder into a broadcastable 7702 UserOperation.
    ///
    /// Constructs a UserOperation sent from the `sender` that executes the provided transaction,
    /// with an additional fee note transfer to cover the bundler fees. The `fee_payer` is the
    /// signer that will authorize the fee note transfer to the bundler's address for the estimated
    /// fee amount in `fee_token`.
    pub async fn prepare_broadcast<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        sender: Address,
        fee_payer: Arc<dyn RailgunSigner>,
        fee_token: Address,
        rng: &mut R,
    ) -> Result<UserOperation, RailgunProviderError> {
        let bundler = self
            .bundler
            .clone()
            .ok_or(RailgunProviderError::NoBundler)?;

        let fee_asset = AssetId::Erc20(fee_token);

        // 7702 authorization
        let sender_nonce = self.provider.transaction_count(sender, None).await?;
        info!(
            "Signing 7702 authorization for sender: {:?}, nonce: {}",
            sender, sender_nonce
        );

        //? Initial arbitrary estimation of fee note value.
        //? IMPORTANT: Needs to be high enough to not cause a revert. Most
        //? bundlers seem to use a fixed maxCost value for estimation (IE 27_000_000
        //? for pimlico). Setting this too low causes an unrecoverable estimation
        //? failure.
        let mut fee_value = 100_000_000;

        info!("Fetching max fee per gas from bundler");
        let max_fee_per_gas = bundler.suggest_max_fee_per_gas().await?;

        info!("Iteratively building UserOperation to converge on accurate fee estimate");
        let mut userop = UserOperation::default();

        for _ in 0..5 {
            let broadcast_builder = builder.clone().transfer(
                fee_payer.clone(),
                RailgunAddress::new(
                    MasterPublicKey::from_bytes(*PAYMASTER_MASTER_PUBLIC_KEY),
                    ViewingPublicKey::from_bytes(*PAYMASTER_VIEWING_PUBLIC_KEY),
                    crate::account::chain::ChainId::evm(self.chain.id),
                ),
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
            let userop_builder = UserOperationBuilder::new_railgun(
                self.chain.id,
                sender,
                sender_nonce,
                fee_calldata.clone(),
                fee_note.random().into(),
                fee_token,
                fee_value,
            )
            .with_tail_calls(vec![tail_call])
            .with_gas_estimate(bundler.as_ref())
            .await?;
            userop = userop_builder.build();

            // TODO: See if we can unify these two buffers into a single safety
            // margin
            //
            // The bundler seems to find the exact minimum call_gas_limit with
            // no margin.
            // Add 10% headroom so the implementation doesn't sporadically OOG.
            userop.call_gas_limit = userop.call_gas_limit * 11 / 10;

            // Add a 10% headroom to the fee estimate to ensure buffer if prices change
            // slightly between estimation and execution
            let total_gas = userop.total_gas_limit();
            let new_fee = total_gas * max_fee_per_gas;
            let new_fee = (new_fee * 11) / 10;

            let delta = new_fee.abs_diff(fee_value);
            fee_value = new_fee;

            if delta <= new_fee / 100 {
                // 1% tolerance
                info!("Fee converged at {}", new_fee);
                break;
            }
            info!("Fee updated to {}, delta: {}", new_fee, delta);
        }

        Ok(userop)
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync_to(block_number).await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync_to(&self.prover, block_number).await?;
        }

        Ok(())
    }

    pub async fn sync(&mut self) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync().await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync(&self.prover).await?;
        }

        Ok(())
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
                    warn!("Error checking POI for note {}: {}", note, e);
                    continue;
                }
            }
        }

        spendable_notes
    }

    async fn build_operation<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<Vec<ProvedOperation>, RailgunProviderError> {
        let in_notes = self.all_unspent().await;
        let operations = builder
            .build(
                &self.prover,
                self.chain.id,
                &in_notes,
                &self.utxo_indexer.utxo_trees,
                rng,
            )
            .await?;

        Ok(operations)
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
