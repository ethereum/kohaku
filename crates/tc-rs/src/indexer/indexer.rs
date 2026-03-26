use std::sync::Arc;

use crypto::merkle_tree::MerkleTreeState;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::info;

use crate::{
    Pool,
    indexer::{
        syncer::{Syncer, SyncerError},
        verifier::{Verifier, VerifierError},
    },
    merkle::{TornadoMerkleConfig, TornadoMerkleTree},
};

pub struct Indexer {
    syncer: Arc<dyn Syncer>,
    verifier: Arc<dyn Verifier>,
    synced_block: u64,
    tree: TornadoMerkleTree,
    pool: Pool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerState {
    pub synced_block: u64,
    pub tree_state: MerkleTreeState<TornadoMerkleConfig>,
    pub amount: String,
    pub symbol: String,
    pub chain_id: u64,
}

impl Indexer {
    pub fn new(syncer: Arc<dyn Syncer>, verifier: Arc<dyn Verifier>, pool: Pool) -> Self {
        Self {
            syncer,
            verifier,
            synced_block: 0,
            tree: TornadoMerkleTree::new(0),
            pool,
        }
    }

    pub fn from_state(
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        state: IndexerState,
    ) -> Result<Self, IndexerError> {
        let pool =
            Pool::from_id(&state.amount, &state.symbol, state.chain_id).ok_or_else(|| {
                IndexerError::UnknownPool(
                    state.amount.clone(),
                    state.symbol.clone(),
                    state.chain_id,
                )
            })?;

        Ok(Self {
            syncer,
            verifier,
            synced_block: state.synced_block,
            tree: TornadoMerkleTree::from_state(state.tree_state),
            pool,
        })
    }

    pub fn tree(&self) -> &TornadoMerkleTree {
        &self.tree
    }

    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub fn state(&self) -> IndexerState {
        IndexerState {
            synced_block: self.synced_block,
            tree_state: self.tree.state(),
            amount: self.pool.amount(),
            symbol: self.pool.symbol(),
            chain_id: self.pool.chain_id,
        }
    }

    /// Verifies that the current root is known on-chain
    pub async fn verify(&self) -> Result<(), IndexerError> {
        Ok(self
            .verifier
            .verify(self.pool.address, self.tree.root())
            .await?)
    }

    pub async fn sync(&mut self) -> Result<(), IndexerError> {
        let latest = self.syncer.latest_block(self.pool.address).await?;
        self.sync_to(latest).await
    }

    pub async fn sync_to(&mut self, to_block: u64) -> Result<(), IndexerError> {
        let from_block = self.synced_block.saturating_add(1);
        if from_block > to_block {
            info!("Already synced to block {}", self.synced_block);
            return Ok(());
        }
        info!("Syncing from block {} to {}", from_block, to_block);

        let leaves = {
            let commitments = self
                .syncer
                .sync_commitments(self.pool.address, from_block, to_block)
                .await?;

            let mut leaves: Vec<(u32, U256)> = Vec::new();
            for c in commitments {
                let val = U256::from_be_bytes(*c.commitment);
                leaves.push((c.leaf_index, val));
            }
            leaves
        };

        let mut sorted = leaves;
        sorted.sort_by_key(|(idx, _)| *idx);

        if !sorted.is_empty() {
            let start = sorted[0].0 as usize;
            let vals: Vec<U256> = sorted.iter().map(|(_, v)| *v).collect();

            self.tree.insert_leaves_raw(&vals, start);
            self.tree.rebuild();
        }

        self.synced_block = to_block;
        Ok(())
    }
}
