use std::{collections::HashMap, sync::Arc};

use alloy::{
    primitives::{Address, B256, Bytes, U256},
    sol_types::SolCall,
};
use eip_1193_provider::provider::{Eip1193Error, Eip1193Provider};
use rand::Rng;
use serde::Serialize;
use thiserror::Error;
use tracing::{info, warn};
use userop_kit::{
    builder::UserOperationBuilder,
    bundler::{Bundler, BundlerError},
    signable_user_operation::SignableUserOperation,
    smart_account::SmartAccount,
};

use crate::{
    account::{address::RailgunAddress, chain::ChainId, signer::RailgunSigner},
    adapter_data::{encode_paymaster_data, encode_railgun_adapter_data, paymaster_railgun_address},
    caip::AssetId,
    chain_config::ChainConfig,
    circuit::groth16_prover::Groth16Prover,
    indexer::utxo_indexer::{UtxoIndexer, UtxoIndexerError},
    note::{Note, utxo::UtxoNote},
    poi::{
        provider::{PoiProvider, PoiProviderError},
        types::PoiStatus,
    },
    transact::{
        ShieldBuilder, TransactionBuilder, TransactionBuilderError,
        proved_transaction::{ProvedOperation, ProvedTx},
    },
};

#[derive(Debug, Serialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
pub struct BalanceEntry {
    pub asset: AssetId,
    /// If POI is enabled, the spendability status of the note according to the POI provider.
    /// Otherwise None.
    #[serde(rename = "poiStatus")]
    pub poi_status: Option<PoiStatus>,
    pub amount: u128,
}

/// Interfaces with the RAILGUN protocol.
pub struct RailgunProvider {
    chain: ChainConfig,
    provider: Arc<dyn Eip1193Provider>,
    utxo_indexer: UtxoIndexer,
    prover: Groth16Prover,
    poi_provider: Option<PoiProvider>,
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
    #[error("Bundler error: {0}")]
    Bundler(#[from] BundlerError),
    #[error("RPC error: {0}")]
    Rpc(#[from] Eip1193Error),
    #[error("Privacy Paymaster not configured for chain: {0}")]
    PrivacyPaymasterNotConfigured(u64),
    #[error("Other: {0}")]
    Other(Box<dyn std::error::Error + Send + Sync>),
}

impl RailgunProvider {
    pub(crate) async fn new(
        chain: ChainConfig,
        provider: Arc<dyn Eip1193Provider>,
        utxo_indexer: UtxoIndexer,
        prover: Groth16Prover,
        poi_provider: Option<PoiProvider>,
    ) -> Result<Self, RailgunProviderError> {
        Ok(Self {
            chain,
            provider,
            utxo_indexer,
            prover,
            poi_provider,
        })
    }

    /// Register a signer with the provider. The provider will index and track
    /// UTXOs for the associated address.
    pub async fn register(
        &mut self,
        signer: Arc<dyn RailgunSigner>,
    ) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.register(signer).await?;
        Ok(())
    }

    /// Syncs the provider to the latest block.
    pub async fn sync(&mut self) -> Result<(), RailgunProviderError> {
        self.sync_to(u64::MAX).await
    }

    /// Syncs the provider to the specified block.
    pub async fn sync_to(&mut self, to_block: u64) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync_to(to_block).await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync_to(&self.prover, to_block).await?;
        }

        Ok(())
    }

    /// Returns the balance for the given address.
    ///
    /// If POI is enabled, only returns the spendable balance according to the POI provider.
    pub async fn balance(&mut self, address: RailgunAddress) -> Vec<BalanceEntry> {
        let unspent = self.unspent(address).await;

        let mut balance_map = HashMap::new();
        for (note, poi_status) in unspent {
            let asset = note.asset();
            let value = note.value();
            *balance_map.entry((asset, poi_status)).or_insert(0) += value;
        }

        balance_map
            .into_iter()
            .map(|((asset, poi_status), amount)| BalanceEntry {
                asset,
                poi_status,
                amount,
            })
            .collect()
    }

    /// Helper to create a shield builder.
    pub fn shield(&self) -> ShieldBuilder {
        ShieldBuilder::new(self.chain.clone())
    }

    /// Helper to create a transaction builder.
    pub fn transact(&self) -> TransactionBuilder {
        TransactionBuilder::new()
    }

    /// Build a transaction builder into a proved, signable transaction.
    pub async fn build<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<ProvedTx, RailgunProviderError> {
        let operations = self.build_operation(builder, rng).await?;
        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.register_ops(&operations).await?;
        }

        let proved_tx = ProvedTx::new(self.chain.railgun_smart_wallet, operations);
        Ok(proved_tx)
    }

    /// Build a transaction builder into a broadcastable 7702 UserOperation.
    ///
    /// Constructs a UserOperation sent from the `delegator_address` that executes the provided
    /// transaction, with an additional fee note transfer to cover the bundler fees. The
    /// `fee_payer` is the signer that will authorize the fee note transfer to the bundler's
    /// address for the estimated fee amount in `fee_token`.
    pub async fn prepare_userop<S: SmartAccount>(
        &mut self,
        builder: TransactionBuilder,
        bundler: &dyn Bundler,
        sender: &S,
        fee_payer: Arc<dyn RailgunSigner>,
        fee_token: Address,
        calldata: S::CallData,
        rng: &mut impl Rng,
    ) -> Result<SignableUserOperation, RailgunProviderError> {
        let privacy_paymaster = self.chain.privacy_paymaster.ok_or(
            RailgunProviderError::PrivacyPaymasterNotConfigured(self.chain.id),
        )?;
        let railgun_fee_adapter = self.chain.railgun_fee_adapter.ok_or(
            RailgunProviderError::PrivacyPaymasterNotConfigured(self.chain.id),
        )?;

        if fee_token != self.chain.wrapped_base_token {
            return Err(RailgunProviderError::Other(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Currently only the wrapped base token is supported for fee payment",
            ))));
        }

        let paymaster_railgun_address = paymaster_railgun_address(ChainId::evm(self.chain.id));
        let fee_asset = AssetId::Erc20(fee_token);
        let calldata = sender.encode_call_data(calldata);

        //? Initial arbitrary estimation of fee note value.
        //? IMPORTANT: Needs to be high enough to not cause a revert. Most
        //? bundlers seem to use a fixed maxCost value for estimation (IE 27_000_000
        //? for pimlico). Setting this too low causes an unrecoverable estimation
        //? failure.
        let mut fee_value = 100_000_000;

        let builder = builder.adapt(railgun_fee_adapter, *sender.address().into_word());

        info!("Iteratively building UserOperation to converge on accurate fee estimate");
        for _ in 0..5 {
            let broadcast_builder = builder.clone().transfer(
                fee_payer.clone(),
                paymaster_railgun_address,
                fee_asset,
                fee_value,
                "fee",
            );

            info!(
                "Building broadcast transaction with fee value: {}",
                fee_value
            );
            let operations = self.build_operation(broadcast_builder, rng).await?;

            // Get the fee operation & note so the decrypted commitment data can be sent to the
            // paymaster.
            let fee_operation = get_fee_operation(&operations, fee_asset, fee_value)?;
            let fee_note = get_fee_note(fee_operation, fee_asset, fee_value)?;

            let random = fee_note.random();
            let asset = fee_token;
            let value = fee_value;
            let transactions = operations.iter().map(|op| op.transaction.clone()).collect();

            let paymaster_data = encode_paymaster_data(
                railgun_fee_adapter,
                encode_railgun_adapter_data(random, asset, value, transactions),
            );

            // Construct UserOperation
            let mut signable = UserOperationBuilder::new_with_smart_account(sender)
                .await
                .map_err(|e| RailgunProviderError::Other(Box::new(e)))?
                .with_calldata(calldata.clone())
                .with_paymaster(privacy_paymaster, paymaster_data)
                .with_gas_estimate(bundler)
                .await?
                .build();

            // Recalculate fee and check for convergence.
            info!("Prepared broadcast transaction: {:?}", signable);
            let estimated_paymaster_verification_gas_limit =
                estimate_paymaster_verification_gas_limit(self.provider.as_ref(), &signable)
                    .await?;
            info!(
                "Estimated paymaster verification gas limit: {}",
                estimated_paymaster_verification_gas_limit
            );
            signable.user_op.paymaster_verification_gas_limit =
                Some(estimated_paymaster_verification_gas_limit);
            let total_gas = signable.total_gas_limit();
            let new_fee = total_gas * signable.user_op.max_fee_per_gas;
            info!("Estimated total gas: {}", total_gas);
            info!(
                "Estimated max fee per gas: {}",
                signable.user_op.max_fee_per_gas
            );

            //? Return once the fee converges within 1% of the previous estimate.
            if new_fee <= fee_value && new_fee.abs_diff(fee_value) <= fee_value / 100 {
                info!("Fee converged at {}, total gas: {}", new_fee, total_gas);
                if let Some(poi_provider) = &mut self.poi_provider {
                    poi_provider.register_ops(&operations).await?;
                }
                return Ok(signable);
            }
            fee_value = new_fee;
            info!("Fee updated to {}", new_fee);
        }

        return Err(RailgunProviderError::Other(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Failed to converge on fee estimate",
        ))));
    }

    async fn all_unspent(&mut self) -> Vec<(UtxoNote, Option<PoiStatus>)> {
        let addresses = self.utxo_indexer.registered();
        let mut all_notes = Vec::new();

        for address in addresses {
            let mut notes = self.unspent(address).await;
            all_notes.append(&mut notes);
        }
        all_notes
    }

    async fn unspent(&mut self, address: RailgunAddress) -> Vec<(UtxoNote, Option<PoiStatus>)> {
        let notes = self.utxo_indexer.unspent(address);

        let Some(poi_provider) = &mut self.poi_provider else {
            return notes.into_iter().map(|note| (note, None)).collect();
        };

        let mut annotated_notes = Vec::new();
        for note in notes {
            let status = poi_provider
                .status(note.blinded_commitment.into(), note.commitment_type)
                .await;
            match status {
                Ok(status) => {
                    annotated_notes.push((note, Some(status)));
                }
                Err(e) => {
                    warn!("Error checking POI for note {}: {}", note, e);
                    annotated_notes.push((note, Some(PoiStatus::Missing)));
                }
            }
        }

        annotated_notes
    }

    async fn build_operation<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<Vec<ProvedOperation>, RailgunProviderError> {
        let in_notes = self.all_unspent().await;
        let spendable_notes: Vec<UtxoNote> = if let Some(_) = self.poi_provider {
            in_notes
                .into_iter()
                .filter(|(_, status)| *status == Some(PoiStatus::Valid))
                .map(|(note, _)| note)
                .collect()
        } else {
            in_notes.into_iter().map(|(note, _)| note).collect()
        };

        let operations = builder
            .build(
                &self.prover,
                self.chain.id,
                &spendable_notes,
                &self.utxo_indexer.utxo_trees,
                rng,
            )
            .await?;

        Ok(operations)
    }
}

/// Gets the operation containing the fee note
fn get_fee_operation<'a>(
    operations: &'a Vec<ProvedOperation>,
    fee_asset: AssetId,
    fee_value: u128,
) -> Result<&'a ProvedOperation, RailgunProviderError> {
    let Some(fee_note_pos) = operations.iter().position(|o| {
        o.inner
            .out_notes()
            .iter()
            .any(|n| is_fee_note(n, fee_asset, fee_value))
    }) else {
        return Err(RailgunProviderError::FeeNoteNotFound);
    };
    Ok(&operations[fee_note_pos])
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

async fn estimate_paymaster_verification_gas_limit(
    provider: &dyn Eip1193Provider,
    user_op: &SignableUserOperation,
) -> Result<u128, RailgunProviderError> {
    let entry_point = user_op.entry_point;
    let Some(paymaster) = user_op.user_op.paymaster else {
        return Ok(0);
    };
    let user_op = user_op.user_op.into_packed();
    let data = abi::PrivacyPaymaster::validatePaymasterUserOpCall {
        userOp: abi::PrivacyPaymaster::PackedUserOperation {
            sender: user_op.sender,
            nonce: user_op.nonce,
            initCode: user_op.initCode,
            callData: user_op.callData,
            accountGasLimits: user_op.accountGasLimits,
            preVerificationGas: user_op.preVerificationGas,
            gasFees: user_op.gasFees,
            paymasterAndData: user_op.paymasterAndData,
            signature: Bytes::new(),
        },
        userOpHash: B256::ZERO,
        maxCost: U256::ZERO,
    }
    .abi_encode()
    .into();

    Ok(provider
        .estimate_gas(paymaster, data, Some(entry_point))
        .await? as u128)
}

mod abi {
    use alloy::sol;

    sol!(
        contract PrivacyPaymaster {
            function validatePaymasterUserOp(
                PackedUserOperation calldata userOp,
                bytes32 userOpHash,
                uint256 maxCost
            ) external returns (bytes memory context, uint256 validationData);

            struct PackedUserOperation {
                address sender;
                uint256 nonce;
                bytes initCode;
                bytes callData;
                bytes32 accountGasLimits;
                uint256 preVerificationGas;
                bytes32 gasFees;
                bytes paymasterAndData;
                bytes signature;
            }
        }
    );
}
