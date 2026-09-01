use std::sync::Arc;

use eip_1193_provider::provider::{Eip1193Error, Eip1193Provider, IntoEip1193Provider};
use tracing::{info, warn};

use crate::{
    chain_config::ChainConfig,
    indexer::syncer::{SyncEvent, SyncerError, UtxoSyncer, log_to_sync_events},
};

/// JSON-RPC UTXO syncer.
///
/// Queries an Ethereum node for events emitted by the RailgunSmartWallet and parses them into
/// SyncEvents.
pub struct RpcSyncer {
    chain: ChainConfig,
    provider: Arc<dyn Eip1193Provider>,
    batch_size: u64,
    batch_delay: web_time::Duration,
}

#[derive(Debug, thiserror::Error)]
enum RpcSyncerError {
    #[error("RPC error: {0}")]
    RpcError(#[from] Eip1193Error),
}

impl RpcSyncer {
    pub fn new(chain: ChainConfig, provider: impl IntoEip1193Provider) -> Self {
        Self {
            chain,
            provider: provider.into_eip1193(),
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

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl UtxoSyncer for RpcSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        Ok(self.latest_block().await?)
    }

    async fn sync(&self, from_block: u64, to_block: u64) -> Result<Vec<SyncEvent>, SyncerError> {
        Ok(self.events(from_block, to_block).await?)
    }
}

impl RpcSyncer {
    async fn latest_block(&self) -> Result<u64, RpcSyncerError> {
        Ok(self.provider.get_block_number().await?)
    }

    async fn events(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, RpcSyncerError> {
        let from_block = from_block.max(self.chain.deployment_block);

        let mut all_events = Vec::new();
        let mut current_from = from_block;
        while current_from <= to_block {
            let batch_start = current_from;
            let batch_end = to_block.min(current_from + self.batch_size - 1);

            let logs = self
                .provider
                .logs(
                    self.chain.railgun_smart_wallet,
                    None,
                    Some(batch_start),
                    Some(batch_end),
                )
                .await?;
            common::sleep(self.batch_delay).await;

            for log in logs {
                match log_to_sync_events(log) {
                    Ok(events) => all_events.extend(events),
                    Err(e) => warn!("Failed to parse log into SyncEvent: {}", e),
                }
            }
            current_from = batch_end + 1;
            info!("{}/{} ({} events)", batch_end, to_block, all_events.len());
        }

        Ok(all_events)
    }
}

impl From<RpcSyncerError> for SyncerError {
    fn from(e: RpcSyncerError) -> Self {
        SyncerError::new(e)
    }
}
