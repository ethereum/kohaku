use std::sync::Arc;

use alloy::primitives::B256;
use ruint::aliases::U256;
use thiserror::Error;
use tracing::info;

use crate::{
    indexer::{
        syncer::{SyncEvent, Syncer, SyncerError},
        verifier::{Verifier, VerifierError},
    },
    merkle::TornadoMerkleTree,
    provider::pool::Pool,
};

pub struct Indexer {
    pool: Pool,
    syncer: Arc<dyn Syncer>,
    verifier: Arc<dyn Verifier>,
    synced_block: u64,
    tree: TornadoMerkleTree,
    nullifiers: Vec<B256>,
}

#[derive(Debug, Error)]
pub enum IndexerError {
    #[error("Syncer error: {0}")]
    Syncer(#[from] SyncerError),
    #[error("Verifier error: {0}")]
    Verifier(#[from] VerifierError),
    #[error("Unknown pool: amount={0}, symbol={1}, chain_id={2}")]
    UnknownPool(String, String, u64),
}

impl Indexer {
    pub fn new(pool: Pool, syncer: Arc<dyn Syncer>, verifier: Arc<dyn Verifier>) -> Self {
        Self {
            pool,
            syncer,
            verifier,
            synced_block: 0,
            tree: TornadoMerkleTree::new(0),
            nullifiers: Vec::new(),
        }
    }

    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub fn tree(&self) -> &TornadoMerkleTree {
        &self.tree
    }

    /// Verifies that the current root is known on-chain
    pub async fn verify(&self) -> Result<(), IndexerError> {
        Ok(self.verifier.verify(&self.pool, self.tree.root()).await?)
    }

    pub async fn sync(&mut self) -> Result<(), IndexerError> {
        let latest = self.syncer.latest_block(&self.pool).await?;
        self.sync_to(latest).await
    }

    #[tracing::instrument(name = "sync", skip_all)]
    pub async fn sync_to(&mut self, to_block: u64) -> Result<(), IndexerError> {
        let from_block = self.synced_block.max(self.pool.deployed_block);
        if from_block >= to_block {
            info!("Already synced to block {}", self.synced_block);
            return Ok(());
        }
        info!("Syncing from {} to {}", from_block, to_block);

        let events = self.syncer.sync(&self.pool, from_block, to_block).await?;
        info!("Synced {} events", events.len());

        let mut leaves = Vec::new();
        let mut nullifiers = Vec::new();
        for event in events {
            match event {
                SyncEvent::Deposit(d) => {
                    leaves.push((d.leafIndex, U256::from_be_bytes(*d.commitment)));
                }
                SyncEvent::Withdrawal(w) => {
                    nullifiers.push(w.nullifierHash);
                }
            }
        }

        self.nullifiers.extend(nullifiers);
        leaves.sort_by_key(|(idx, _)| *idx);

        if !leaves.is_empty() {
            let start = leaves[0].0 as usize;
            let leaves: Vec<U256> = leaves.into_iter().map(|(_, val)| val).collect();

            self.tree.insert_leaves(&leaves, start);
        }

        self.synced_block = to_block;
        Ok(())
    }
}
