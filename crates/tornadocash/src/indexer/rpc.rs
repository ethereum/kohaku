use std::sync::Arc;

use alloy::{primitives::Log, sol_types::SolEvent};
use eip_1193_provider::provider::{Eip1193Caller, Eip1193Provider};
use ruint::aliases::U256;
use tracing::{info, warn};

use crate::{
    abis::tornado::{
        MerkleTreeWithHistory,
        Tornado::{Deposit, Withdrawal},
    },
    indexer::{
        syncer::{SyncEvent, Syncer, SyncerError},
        verifier::{Verifier, VerifierError},
    },
    merkle::MerkleRoot,
    provider::pool::Pool,
};

/// A syncer and verifier that reads from an Ethereum JSON-RPC provider
pub struct RpcSyncer {
    provider: Arc<dyn Eip1193Provider>,
    batch_size: u64,
    batch_delay: web_time::Duration,
}

#[derive(Debug, thiserror::Error)]
enum RpcSyncerError {
    #[error("Error decoding log: {0}")]
    LogDecodeError(#[from] alloy::sol_types::Error),
    #[error("RPC error: {0}")]
    RpcError(#[from] eip_1193_provider::provider::Eip1193Error),
    #[error("Unknown event with topics {topics:?}")]
    UnknownEvent {
        topics: Vec<alloy::primitives::B256>,
    },
}

impl RpcSyncer {
    pub fn new(provider: Arc<dyn Eip1193Provider>) -> Self {
        Self {
            provider,
            batch_size: 10,
            batch_delay: web_time::Duration::from_millis(1000),
        }
    }

    /// Sets the batch size for `eth_getLogs` calls.
    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }

    /// Sets the delay between `eth_getLogs` calls.
    pub fn with_batch_delay(mut self, batch_delay: web_time::Duration) -> Self {
        self.batch_delay = batch_delay;
        self
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Syncer for RpcSyncer {
    async fn latest_block(&self, pool: &Pool) -> Result<u64, SyncerError> {
        Ok(self.latest_block(pool).await?)
    }

    async fn sync(
        &self,
        pool: &Pool,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, SyncerError> {
        Ok(self.sync(pool, from_block, to_block).await?)
    }
}

impl RpcSyncer {
    async fn latest_block(&self, _: &Pool) -> Result<u64, RpcSyncerError> {
        Ok(self.provider.get_block_number().await?)
    }

    async fn sync(
        &self,
        pool: &Pool,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, RpcSyncerError> {
        let from_block = from_block.max(pool.deployed_block);
        let mut all_events = Vec::new();
        let mut current_from = from_block;

        while current_from < to_block {
            let batch_start = current_from;
            let batch_end = to_block.min(current_from + self.batch_size - 1);

            let logs: Vec<Log> = self
                .provider
                .logs(pool.address, None, Some(batch_start), Some(batch_end))
                .await?
                .into_iter()
                .map(|log| log.into())
                .collect();
            common::sleep(self.batch_delay).await;

            for log in logs {
                match log_to_sync_events(log) {
                    Ok(events) => all_events.extend(events),
                    Err(e) => warn!("Failed to decode log: {}", e),
                }
            }

            current_from = batch_end + 1;
            info!("{}/{} ({} events)", batch_end, to_block, all_events.len());
        }

        Ok(all_events)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Verifier for RpcSyncer {
    async fn verify(&self, pool: &Pool, root: MerkleRoot) -> Result<(), VerifierError> {
        let root_u256: U256 = root.into();

        let result = self
            .provider
            .sol_call(
                pool.address,
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

impl From<RpcSyncerError> for SyncerError {
    fn from(e: RpcSyncerError) -> Self {
        SyncerError::new(e)
    }
}

fn log_to_sync_events(log: Log) -> Result<Vec<SyncEvent>, RpcSyncerError> {
    match log.topics().first() {
        Some(&Deposit::SIGNATURE_HASH) => {
            Ok(vec![SyncEvent::Deposit(Deposit::decode_log(&log)?.data)])
        }
        Some(&Withdrawal::SIGNATURE_HASH) => Ok(vec![SyncEvent::Withdrawal(
            Withdrawal::decode_log(&log)?.data,
        )]),
        _ => Err(RpcSyncerError::UnknownEvent {
            topics: log.topics().to_vec(),
        }),
    }
}
