use std::sync::Arc;

use crate::{
    indexer::syncer::{SyncEvent, Syncer, SyncerError},
    provider::pool::Pool,
};

/// A syncer that chains multiple syncers in priority order
pub struct ChainedSyncer {
    syncers: Vec<Arc<dyn Syncer>>,
}

impl ChainedSyncer {
    /// Creates a new ChainedSyncer with the given syncers in priority order
    ///
    /// Syncers will be queried in the order they are provided, first to last
    pub fn new(syncers: Vec<Arc<dyn Syncer>>) -> Self {
        Self { syncers }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Syncer for ChainedSyncer {
    async fn latest_block(&self, pool: &Pool) -> Result<u64, SyncerError> {
        let mut max_block = 0u64;
        for syncer in &self.syncers {
            if let Ok(block) = syncer.latest_block(pool).await {
                max_block = max_block.max(block);
            }
        }
        Ok(max_block)
    }

    async fn sync(
        &self,
        pool: &Pool,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, SyncerError> {
        let mut current_from = from_block;

        let mut all_events = Vec::new();
        for (i, syncer) in self.syncers.iter().enumerate() {
            if current_from > to_block {
                break;
            }

            let syncer_latest = syncer.latest_block(pool).await?;
            if syncer_latest < current_from {
                continue;
            }

            let range_end = syncer_latest.min(to_block);
            match syncer.sync(pool, current_from, range_end).await {
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
