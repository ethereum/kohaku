use std::sync::Arc;

use alloy::primitives::Address;

use crate::indexer::{Commitment, Nullifier, Syncer, SyncerError};

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

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl Syncer for ChainedSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        let mut max_block = 0u64;
        for syncer in &self.syncers {
            if let Ok(block) = syncer.latest_block().await {
                max_block = max_block.max(block);
            }
        }
        Ok(max_block)
    }

    async fn sync_commitments(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Commitment>, SyncerError> {
        let mut current_from = from_block;

        let mut all_commitments = Vec::new();
        for (i, syncer) in self.syncers.iter().enumerate() {
            if current_from > to_block {
                break;
            }

            let syncer_latest = syncer.latest_block().await?;
            if syncer_latest < current_from {
                continue;
            }

            let range_end = syncer_latest.min(to_block);
            match syncer
                .sync_commitments(contract, current_from, range_end)
                .await
            {
                Ok(commitments) => all_commitments.extend(commitments),
                Err(e) => {
                    tracing::warn!("Syncer {} failed: {}", i, e);
                }
            }

            current_from = range_end + 1;
        }

        Ok(all_commitments)
    }

    async fn sync_nullifiers(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Nullifier>, SyncerError> {
        let mut current_from = from_block;

        let mut all_nullifiers = Vec::new();
        for (i, syncer) in self.syncers.iter().enumerate() {
            if current_from > to_block {
                break;
            }

            let syncer_latest = syncer.latest_block().await?;
            if syncer_latest < current_from {
                continue;
            }

            let range_end = syncer_latest.min(to_block);
            match syncer
                .sync_nullifiers(contract, current_from, range_end)
                .await
            {
                Ok(nullifiers) => all_nullifiers.extend(nullifiers),
                Err(e) => {
                    tracing::warn!("Syncer {} failed: {}", i, e);
                }
            }

            current_from = range_end + 1;
        }

        Ok(all_nullifiers)
    }
}
