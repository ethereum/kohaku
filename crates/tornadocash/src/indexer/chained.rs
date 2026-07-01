use std::sync::Arc;

use tracing::info;

use crate::{
    indexer::syncer::{SyncEvent, Syncer, SyncerError},
    provider::pool::Pool,
};

/// Helper syncer that chains multiple UTXO syncers together.
///
/// Syncers are queried in the order they are added, and the sync range is adjusted based on the
/// latest block of each syncer.
#[derive(Default)]
pub struct ChainedSyncer {
    syncers: Vec<Arc<dyn Syncer>>,
}

impl ChainedSyncer {
    pub fn new() -> Self {
        Self {
            syncers: Vec::new(),
        }
    }

    /// Adds a syncer to the chain. Syncers are queried in the order they are added.
    pub fn then<S: Syncer + 'static>(mut self, syncer: S) -> Self {
        self.syncers.push(Arc::new(syncer));
        self
    }

    /// Adds a syncer to the chain. Syncers are queried in the order they are added.
    pub fn then_arc(mut self, syncer: Arc<dyn Syncer>) -> Self {
        self.syncers.push(syncer);
        self
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Syncer for ChainedSyncer {
    async fn latest_block(&self, pool: &Pool) -> Result<u64, SyncerError> {
        let mut max_block = 0u64;
        for syncer in &self.syncers {
            match syncer.latest_block(pool).await {
                Ok(block) => {
                    max_block = max_block.max(block);
                }
                Err(e) => {
                    tracing::warn!("Syncer failed to get latest block: {}", e);
                }
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
        info!("Syncing from {} to {}", from_block, to_block);
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
