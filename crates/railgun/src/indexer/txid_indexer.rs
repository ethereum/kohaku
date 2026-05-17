use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

use crate::{
    crypto::railgun_txid::Txid,
    database::{Database, DatabaseError, RailgunDB},
    indexer::syncer::{Operation, SyncerError, TxidSyncer},
    merkle_tree::{TOTAL_LEAVES, TxidLeafHash, TxidMerkleTree, UtxoTreeIndex},
    poi::client::{PoiClientError, PoiNodeClient},
};

pub struct TxidIndexer {
    trees: HashMap<u32, TxidMerkleTree>,
    inner: TxidIndexerState,

    db: Arc<dyn Database>,
    txid_syncer: Arc<dyn TxidSyncer>,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct TxidIndexerState {
    pub synced_block: u64,
    pub trees: Vec<u32>,
    pub pending: Vec<Operation>,
    pub txid_to_utxo_position: HashMap<Txid, (u32, u32)>,
    pub txid_to_txid_position: HashMap<Txid, (u32, u32)>,
}

#[derive(Debug, Error)]
pub enum TxidIndexerError {
    #[error("Syncer error: {0}")]
    SyncerError(#[from] SyncerError),
    #[error("POI client error: {0}")]
    PoiClient(#[from] PoiClientError),
    #[error("TXID tree root mismatch for tree {tree_number}")]
    RootMismatch { tree_number: u32 },
    #[error("Database error: {0}")]
    DatabaseError(#[from] DatabaseError),
}

impl TxidIndexer {
    pub async fn new(
        db: Arc<dyn Database>,
        txid_syncer: Arc<dyn TxidSyncer>,
    ) -> Result<Self, TxidIndexerError> {
        let inner = db.get_txid_indexer().await?;

        let mut txid_trees = HashMap::new();
        for number in inner.trees.clone() {
            let tree_state = db.get_txid_tree(number).await?;
            if let Some(tree_state) = tree_state {
                txid_trees.insert(number, TxidMerkleTree::from_state(tree_state));
            }
        }

        Ok(TxidIndexer {
            inner,
            trees: txid_trees,
            db,
            txid_syncer,
        })
    }

    pub fn tree(&self, tree_number: u32) -> Option<&TxidMerkleTree> {
        self.trees.get(&tree_number)
    }

    pub fn txid_position(&self, txid: &Txid) -> Option<(u32, u32)> {
        self.inner.txid_to_txid_position.get(txid).cloned()
    }

    pub fn utxo_position(&self, txid: &Txid) -> Option<(u32, u32)> {
        self.inner.txid_to_utxo_position.get(txid).cloned()
    }

    #[tracing::instrument(name = "txid_sync", skip_all)]
    pub async fn sync_to(
        &mut self,
        to_block: u64,
        poi_client: &impl PoiNodeClient,
    ) -> Result<(), TxidIndexerError> {
        let from_block = self.inner.synced_block + 1;

        let syncer = self.txid_syncer.clone();
        let latest_block = syncer.latest_block().await?;
        let to_block = to_block.min(latest_block);

        let ops = syncer.sync(from_block, to_block).await?;
        info!("Fetched {} operations from syncer", ops.len());
        for op in ops {
            self.inner.pending.push(op);
        }
        self.inner.synced_block = to_block;

        self.update(poi_client).await?;
        self.save().await?;
        Ok(())
    }

    #[tracing::instrument(name = "txid_update", skip_all)]
    async fn update(&mut self, poi_client: &impl PoiNodeClient) -> Result<(), TxidIndexerError> {
        let validated = poi_client.validated_txid().await?;
        info!(
            "Latest validated txid index from POI: tree {}, leaf {}",
            validated.tree(),
            validated.leaf_index()
        );

        let current_total = self.trees.values().map(|t| t.leaves_len() as u32).sum();
        let target_total = validated.tree() * TOTAL_LEAVES + validated.leaf_index() + 1;

        let to_drain = target_total.saturating_sub(current_total) as usize;
        if to_drain == 0 {
            return Ok(());
        }

        let drain_count = to_drain.min(self.inner.pending.len());
        let drained: Vec<_> = self.inner.pending.drain(..drain_count).collect();

        let mut total = current_total;
        for op in drained {
            let txid = Txid::new(&op.nullifiers, &op.commitment_hashes, op.bound_params_hash);

            if let Some(&existing_pos) = self.inner.txid_to_txid_position.get(&txid) {
                warn!(
                    "Skipping duplicate operation: txid {:?} already at tree {}, leaf {}",
                    txid, existing_pos.0, existing_pos.1
                );
                continue;
            }

            let included = UtxoTreeIndex::included(op.utxo_tree_out, op.utxo_out_start_index);
            let leaf = TxidLeafHash::new(txid, op.utxo_tree_in, included);

            let tree_number = total / TOTAL_LEAVES;
            let position = total % TOTAL_LEAVES;

            self.trees
                .entry(tree_number)
                .or_insert_with(|| TxidMerkleTree::new(tree_number))
                .insert_leaves(&[leaf], position as usize);

            self.inner
                .txid_to_txid_position
                .insert(txid, (tree_number, position as u32));
            self.inner
                .txid_to_utxo_position
                .insert(txid, (op.utxo_tree_out, op.utxo_out_start_index));

            if total % 10000 == 0 {
                info!(
                    "Drained {}/{} operations",
                    total - current_total,
                    target_total
                );
            }
            total += 1;
        }

        info!("Drained {} operations", drain_count);

        info!("Rebuilding TXID trees");
        for tree in self.trees.values_mut() {
            tree.rebuild();
        }

        info!("Validating TXID trees");
        for (tree_number, tree) in self.trees.iter() {
            let index = tree.leaves_len() as u32 - 1;
            let merkleroot = tree.root();
            let validated = poi_client
                .validate_txid_merkleroot(*tree_number, index, merkleroot)
                .await?;

            if !validated {
                return Err(TxidIndexerError::RootMismatch {
                    tree_number: *tree_number,
                });
            }

            info!(
                "Validated TXID tree up to tree {}, leaf {} (total {})",
                tree_number,
                index,
                total - 1
            );
        }

        Ok(())
    }

    async fn save(&self) -> Result<(), DatabaseError> {
        let state = TxidIndexerState {
            synced_block: self.inner.synced_block,
            trees: self.trees.keys().cloned().collect(),
            pending: self.inner.pending.clone(),
            txid_to_utxo_position: self.inner.txid_to_utxo_position.clone(),
            txid_to_txid_position: self.inner.txid_to_txid_position.clone(),
        };
        self.db.set_txid_indexer(&state).await?;

        for (tree_number, tree) in self.trees.iter() {
            self.db.set_txid_tree(*tree_number, tree.state()).await?;
        }

        Ok(())
    }
}
