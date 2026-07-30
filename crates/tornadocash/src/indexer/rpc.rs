use alloy::{
    network::TransactionBuilder,
    primitives::{B256, U256},
    providers::Provider,
    rpc::types::{Filter, Log, TransactionRequest},
    sol_types::{SolCall, SolEvent},
};
use anyhow::Context;
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
pub struct RpcSyncer<P: Provider> {
    provider: P,
    batch_size: u64,
    batch_delay: web_time::Duration,
}

#[derive(Debug, thiserror::Error)]
enum RpcSyncerError {
    #[error("Error decoding log: {0}")]
    LogDecodeError(#[from] alloy::sol_types::Error),
    #[error("RPC error: {0}")]
    RpcError(#[from] alloy::transports::RpcError<alloy::transports::TransportErrorKind>),
    #[error("Unknown event with topics {topics:?}")]
    UnknownEvent {
        topics: Vec<alloy::primitives::B256>,
    },
}

impl<P: Provider> RpcSyncer<P> {
    pub fn new(provider: P) -> Self {
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
impl<P: Provider> Syncer for RpcSyncer<P> {
    async fn latest_block(&self, pool: &Pool) -> Result<u64, SyncerError> {
        Ok(self
            .latest_block(pool)
            .await
            .context("Failed to get latest block")?)
    }

    async fn sync(
        &self,
        pool: &Pool,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, SyncerError> {
        info!("Syncing from {} to {}", from_block, to_block);
        Ok(self
            .sync(pool, from_block, to_block)
            .await
            .context("Failed to sync events")?)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl<P: Provider> Verifier for RpcSyncer<P> {
    async fn verify(&self, pool: &Pool, root: MerkleRoot) -> Result<(), VerifierError> {
        let root_u256: U256 = root.into();
        let call =
            MerkleTreeWithHistory::isKnownRootCall::new((B256::from(root_u256),)).abi_encode();

        let result = self
            .provider
            .call(
                TransactionRequest::default()
                    .with_to(pool.address)
                    .input(call.into()),
            )
            .await
            .context("Failed to call isKnownRoot")?;
        let result = MerkleTreeWithHistory::isKnownRootCall::abi_decode_returns(&result)
            .context("Failed to decode isKnownRoot result")?;

        if result {
            Ok(())
        } else {
            Err(VerifierError::InvalidRoot { root })
        }
    }
}

impl<P: Provider> RpcSyncer<P> {
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

            let filter = Filter::new()
                .address(pool.address)
                .from_block(batch_start)
                .to_block(batch_end);

            let logs = self.provider.get_logs(&filter).await?;
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

fn log_to_sync_events(log: Log) -> Result<Vec<SyncEvent>, RpcSyncerError> {
    match log.topics().first() {
        Some(&Deposit::SIGNATURE_HASH) => Ok(vec![SyncEvent::Deposit(
            Deposit::decode_log(&log.inner)?.data,
        )]),
        Some(&Withdrawal::SIGNATURE_HASH) => Ok(vec![SyncEvent::Withdrawal(
            Withdrawal::decode_log(&log.inner)?.data,
        )]),
        _ => Err(RpcSyncerError::UnknownEvent {
            topics: log.topics().to_vec(),
        }),
    }
}
