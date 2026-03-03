use std::sync::Arc;

use alloy_primitives::Address;
use alloy_sol_types::SolEvent;
use eth_rpc::{EthRpcClient, eth_call_sol};
use ruint::aliases::U256;
use tracing::{info, warn};

use crate::{
    abis::tornado::{MerkleTreeWithHistory, Tornado},
    indexer::{
        syncer::{Commitment, Nullifier, Syncer, SyncerError},
        verifier::{Verifier, VerifierError},
    },
    merkle::MerkleRoot,
};

/// A syncer and verifier that reads from an Ethereum JSON-RPC provider
pub struct RpcSyncer {
    provider: Arc<dyn EthRpcClient>,
    batch_size: u64,
}

impl RpcSyncer {
    pub fn new(provider: Arc<dyn EthRpcClient>) -> Self {
        Self {
            provider,
            batch_size: 2000,
        }
    }

    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Syncer for RpcSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        self.provider
            .get_block_number()
            .await
            .map_err(|e| SyncerError::Syncer(Box::new(e)))
    }

    async fn sync_commitments(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Commitment>, SyncerError> {
        let batch_size = self.batch_size;
        let contract_address = contract;
        let provider = &self.provider;

        let mut all_commitments = Vec::new();
        let mut current_block = from_block;
        loop {
            if current_block > to_block {
                break;
            }

            let batch_start = current_block;
            let batch_end = to_block.min(current_block + batch_size - 1);
            current_block = batch_end + 1;

            let logs = match provider
                .get_logs(
                    contract_address,
                    Some(Tornado::Deposit::SIGNATURE_HASH),
                    Some(batch_start),
                    Some(batch_end),
                )
                .await
            {
                Ok(logs) => logs,
                Err(e) => {
                    warn!(
                        "Failed to fetch logs for commitments {}-{}: {}",
                        batch_start, batch_end, e
                    );
                    continue;
                }
            };

            let commitments: Vec<Commitment> = logs
                .into_iter()
                .filter_map(|log| match log.try_into() {
                    Ok(commitment) => Some(commitment),
                    Err(e) => {
                        warn!("Failed to parse log into Commitment: {}", e);
                        None
                    }
                })
                .collect();

            info!(
                "{}/{} ({} commitments)",
                batch_end,
                to_block,
                all_commitments.len()
            );
            all_commitments.extend(commitments);
        }

        Ok(all_commitments)
    }

    async fn sync_nullifiers(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Nullifier>, SyncerError> {
        let batch_size = self.batch_size;
        let contract_address = contract;
        let provider = &self.provider;

        let mut all_nullifiers = Vec::new();
        let mut current_block = from_block;
        loop {
            if current_block > to_block {
                break;
            }

            let batch_start = current_block;
            let batch_end = to_block.min(current_block + batch_size - 1);
            current_block = batch_end + 1;

            let logs = match provider
                .get_logs(
                    contract_address,
                    Some(Tornado::Withdrawal::SIGNATURE_HASH),
                    Some(batch_start),
                    Some(batch_end),
                )
                .await
            {
                Ok(logs) => logs,
                Err(e) => {
                    warn!(
                        "Failed to fetch logs for nullifiers {}-{}: {}",
                        batch_start, batch_end, e
                    );
                    continue;
                }
            };

            let nullifiers: Vec<Nullifier> = logs
                .into_iter()
                .filter_map(|log| match log.try_into() {
                    Ok(nullifier) => Some(nullifier),
                    Err(e) => {
                        warn!("Failed to parse log into Nullifier: {}", e);
                        None
                    }
                })
                .collect();

            info!(
                "Fetched {} nullifiers from blocks {}-{}",
                nullifiers.len(),
                batch_start,
                batch_end
            );
            all_nullifiers.extend(nullifiers);
        }

        Ok(all_nullifiers)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Verifier for RpcSyncer {
    async fn verify(&self, contract: Address, root: MerkleRoot) -> Result<(), VerifierError> {
        let root_u256: U256 = root.into();

        let result = eth_call_sol(
            self.provider.as_ref(),
            contract,
            MerkleTreeWithHistory::isKnownRootCall {
                _root: root_u256.into(),
            },
        )
        .await
        .map_err(|e| VerifierError::Other(Box::new(e)))?;

        if result {
            Ok(())
        } else {
            Err(VerifierError::InvalidRoot { root })
        }
    }
}
