use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    crypto::railgun_txid::Txid,
    railgun::{
        indexer::{
            syncer::TransactionSyncer,
            txid_tree_set::{TxidTreeError, TxidTreeSet, TxidTreeSetState},
        },
        merkle_tree::TxidMerkleTree,
        poi::PoiClient,
    },
};

/// TxID indexer that maintains the set of Txid merkle trees.
pub struct TxidIndexer {
    txid_set: TxidTreeSet,
    synced_block: u64,
    txid_syncer: Arc<dyn TransactionSyncer>,
}

#[derive(Serialize, Deserialize)]
pub struct TxidIndexerState {
    pub txid_tree: TxidTreeSetState,
    pub synced_operations_block: u64,
}

#[derive(Debug, Error)]
pub enum TxidIndexerError {
    #[error("Syncer error: {0}")]
    SyncerError(Box<dyn std::error::Error>),
    #[error("TXID tree error: {0}")]
    TxidTreeError(#[from] TxidTreeError),
}

impl TxidIndexer {
    pub fn new(txid_syncer: Arc<dyn TransactionSyncer>, poi_client: PoiClient) -> Self {
        TxidIndexer {
            txid_set: TxidTreeSet::new(poi_client),
            synced_block: 0,
            txid_syncer,
        }
    }

    pub fn set_state(&mut self, state: TxidIndexerState) {
        self.txid_set.set_state(state.txid_tree);
        self.synced_block = state.synced_operations_block;
    }

    pub fn state(&self) -> TxidIndexerState {
        TxidIndexerState {
            txid_tree: self.txid_set.state(),
            synced_operations_block: self.synced_block,
        }
    }

    pub fn tree(&self, tree_number: u32) -> Option<&TxidMerkleTree> {
        self.txid_set.trees.get(&tree_number)
    }

    /// Returns the position of a given TxID in the TXID tree, if included.
    pub fn txid_position(&self, txid: &Txid) -> Option<(u32, u32)> {
        self.txid_set.txid_to_txid_pos.get(txid).cloned()
    }

    /// Returns the position of a given TxID in the UTXO tree, if included.
    pub fn utxo_position(&self, txid: &Txid) -> Option<(u32, u32)> {
        self.txid_set.txid_to_utxo_pos.get(txid).cloned()
    }

    pub async fn sync(&mut self) -> Result<(), TxidIndexerError> {
        self.sync_to(u64::MAX).await
    }

    #[tracing::instrument(name = "txid_sync", skip_all)]
    pub async fn sync_to(&mut self, to_block: u64) -> Result<(), TxidIndexerError> {
        let from_block = self.synced_block + 1;

        let syncer = self.txid_syncer.clone();
        let latest_block = syncer
            .latest_block()
            .await
            .map_err(TxidIndexerError::SyncerError)?;
        let to_block = to_block.min(latest_block);

        // Sync
        let ops = syncer
            .sync(from_block, to_block)
            .await
            .map_err(TxidIndexerError::SyncerError)?;
        for (op, block) in ops {
            self.txid_set.enqueue(op, block);
        }
        self.synced_block = to_block;

        // Advance
        self.txid_set.update().await?;

        Ok(())
    }

    /// Resets the indexer state
    pub fn reset(&mut self) {
        self.txid_set.reset();
        self.synced_block = 0;
    }
}
