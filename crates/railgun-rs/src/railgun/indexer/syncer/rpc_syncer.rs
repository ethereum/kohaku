use alloy::{
    providers::{DynProvider, Provider},
    rpc::types::Filter,
};
use alloy_sol_types::SolEvent;
use futures::{Stream, StreamExt, stream};
use tracing::{info, warn};

use crate::{
    abis::railgun::RailgunSmartWallet,
    chain_config::ChainConfig,
    railgun::indexer::syncer::{
        compat::BoxedSyncStream,
        syncer::{NoteSyncer, SyncEvent},
    },
    sleep::sleep,
};

pub struct RpcSyncer {
    provider: DynProvider,
    batch_size: u64,
    timeout: web_time::Duration,
    chain: ChainConfig,
}

#[derive(Debug, thiserror::Error)]
pub enum RpcSyncerError {
    #[error("Error decoding log: {0}")]
    LogDecodeError(#[from] alloy_sol_types::Error),
}

impl RpcSyncer {
    pub fn new(provider: DynProvider, chain: ChainConfig) -> Self {
        Self {
            provider,
            batch_size: 10000,
            timeout: web_time::Duration::from_millis(100),
            chain,
        }
    }

    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }

    pub fn with_timeout(mut self, timeout: web_time::Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl NoteSyncer for RpcSyncer {
    async fn latest_block(&self) -> Result<u64, Box<dyn std::error::Error>> {
        let block_number = self.provider.get_block_number().await?;
        Ok(block_number)
    }

    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<BoxedSyncStream<'_>, Box<dyn std::error::Error>> {
        info!(
            "Starting RPC sync from block {} to block {}",
            from_block, to_block
        );

        Ok(Box::pin(self.event_stream(from_block, to_block)))
    }
}

impl RpcSyncer {
    #[cfg(not(feature = "wasm"))]
    fn event_stream(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + Send + '_ {
        self.event_stream_inner(from_block, to_block)
    }

    #[cfg(feature = "wasm")]
    fn event_stream(&self, from_block: u64, to_block: u64) -> impl Stream<Item = SyncEvent> + '_ {
        self.event_stream_inner(from_block, to_block)
    }

    fn event_stream_inner(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + '_ {
        stream::unfold(from_block, move |current_block| async move {
            if current_block > to_block {
                return None;
            }

            // Fetch the next batch of logs
            let batch_end = std::cmp::min(current_block + self.batch_size - 1, to_block);
            let filter = Filter::new()
                .address(self.chain.railgun_smart_wallet)
                .from_block(current_block)
                .to_block(batch_end);

            let start = web_time::Instant::now();
            let logs = match self.provider.get_logs(&filter).await {
                Ok(logs) => logs,
                Err(e) => {
                    warn!(
                        "Failed to fetch logs from blocks {} to {}: {}",
                        current_block, batch_end, e
                    );
                    return None;
                }
            };
            let duration = start.elapsed();
            let sleep_duration = self.timeout.saturating_sub(duration);
            if sleep_duration > web_time::Duration::from_secs(0) {
                sleep(sleep_duration).await;
            }

            if logs.len() != 0 {
                info!(
                    "Fetched {} logs from blocks {} to {}",
                    logs.len(),
                    current_block,
                    batch_end
                );
            }

            // Decode logs into events
            let mut events = Vec::new();
            for log in logs {
                let topic0 = log.topics()[0];
                let block_number = log.block_number.unwrap_or(0);
                let block_timestamp = log.block_timestamp.unwrap_or(0);

                match topic0 {
                    RailgunSmartWallet::Shield::SIGNATURE_HASH => {
                        match RailgunSmartWallet::Shield::decode_log(&log.inner) {
                            Ok(event) => events.push(SyncEvent::Shield(event.data, block_number)),
                            Err(e) => warn!("Failed to decode Shield event: {}", e),
                        }
                    }
                    RailgunSmartWallet::Transact::SIGNATURE_HASH => {
                        match RailgunSmartWallet::Transact::decode_log(&log.inner) {
                            Ok(event) => {
                                events.push(SyncEvent::Transact(event.data, block_timestamp))
                            }
                            Err(e) => warn!("Failed to decode Transact event: {}", e),
                        }
                    }
                    RailgunSmartWallet::Nullified::SIGNATURE_HASH => {
                        match RailgunSmartWallet::Nullified::decode_log(&log.inner) {
                            Ok(event) => {
                                events.push(SyncEvent::Nullified(event.data, block_timestamp))
                            }
                            Err(e) => warn!("Failed to decode Nullified event: {}", e),
                        }
                    }
                    RailgunSmartWallet::Unshield::SIGNATURE_HASH => {
                        // Unshield events not needed. Spent notes are already
                        // tracked via Nullified events.
                    }
                    _ => {
                        warn!("Unknown event with topic0: {:?}", topic0);
                    }
                }
            }

            // TODO: Operation events are not implemented for RPC syncer.
            // Constructing Operations requires call tracing to correlate which events
            // belong to which Railgun transaction within a block.

            let next_block = batch_end + 1;
            Some((stream::iter(events), next_block))
        })
        .flatten()
    }
}
