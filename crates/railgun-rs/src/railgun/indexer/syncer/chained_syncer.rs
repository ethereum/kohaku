use std::sync::Arc;

use futures::{StreamExt, stream};

use super::{compat::BoxedSyncStream, syncer::NoteSyncer};

/// A syncer that chains multiple syncers in priority order.
pub struct ChainedSyncer {
    syncers: Vec<Arc<dyn NoteSyncer>>,
}

impl ChainedSyncer {
    /// Creates a new ChainedSyncer with the given syncers in priority order.
    ///
    /// Syncers will be queried in the order they are provided, first to last.
    pub fn new(syncers: Vec<Arc<dyn NoteSyncer>>) -> Self {
        Self { syncers }
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl NoteSyncer for ChainedSyncer {
    async fn latest_block(&self) -> Result<u64, Box<dyn std::error::Error>> {
        let mut max_block = 0u64;
        for syncer in &self.syncers {
            if let Ok(block) = syncer.latest_block().await {
                max_block = max_block.max(block);
            }
        }
        Ok(max_block)
    }

    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<BoxedSyncStream<'_>, Box<dyn std::error::Error>> {
        let mut streams: Vec<BoxedSyncStream<'_>> = Vec::new();
        let mut current_from = from_block;

        for (i, syncer) in self.syncers.iter().enumerate() {
            if current_from > to_block {
                break;
            }

            let syncer_latest = syncer.latest_block().await?;
            if syncer_latest < current_from {
                continue;
            }

            let range_end = syncer_latest.min(to_block);
            match syncer.sync(current_from, range_end).await {
                Ok(stream) => streams.push(stream),
                Err(e) => {
                    tracing::warn!("Syncer {} failed: {}", i, e);
                }
            }

            current_from = range_end + 1;
        }

        let combined = stream::iter(streams).flatten();
        Ok(Box::pin(combined))
    }
}
