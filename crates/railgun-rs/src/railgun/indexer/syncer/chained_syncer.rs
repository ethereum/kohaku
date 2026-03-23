use std::sync::Arc;

use super::syncer::NoteSyncer;
use crate::railgun::indexer::syncer::{SyncEvent, syncer::SyncerError};

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

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl NoteSyncer for ChainedSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        let mut max_block = 0u64;
        for syncer in &self.syncers {
            if let Ok(block) = syncer.latest_block().await {
                max_block = max_block.max(block);
            }
        }
        Ok(max_block)
    }

    async fn sync(&self, from_block: u64, to_block: u64) -> Result<Vec<SyncEvent>, SyncerError> {
        let mut current_from = from_block;

        let mut all_events = Vec::new();
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
                Ok(events) => all_events.extend(events),
                Err(e) => {
                    tracing::warn!("Syncer {} failed: {}", i, e);
                }
            }

            current_from = range_end + 1;
        }

        Ok(all_events)
    }
}
