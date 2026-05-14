use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

use crate::{
    crypto::railgun_txid::Txid,
    railgun::{
        indexer::syncer::{Operation, SyncerError, TransactionSyncer},
        merkle_tree::{MerkleTreeState, TOTAL_LEAVES, TxidLeafHash, TxidMerkleTree, UtxoTreeIndex},
        poi::client::{PoiClientError, PoiNodeClient},
    },
};

pub struct TxidIndexer {
    txid_syncer: Arc<dyn TransactionSyncer>,

    trees: HashMap<u32, TxidMerkleTree>,
    /// Maps TXIDs to their (tree_number, leaf_index) position in the UTXO tree.
    txid_to_utxo_pos: HashMap<Txid, (u32, u32)>,
    /// Maps TXIDs to their (tree_number, leaf_index) position in the TXID tree.
    txid_to_txid_pos: HashMap<Txid, (u32, u32)>,
    pending: VecDeque<Operation>,
    synced_block: u64,
}

#[derive(Serialize, Deserialize)]
pub struct TxidIndexerState {
    pub trees: HashMap<u32, MerkleTreeState>,
    pub pending: Vec<Operation>,
    pub txid_to_utxo_position: HashMap<Txid, (u32, u32)>,
    pub txid_to_txid_position: HashMap<Txid, (u32, u32)>,
    pub synced_block: u64,
}

#[derive(Debug, Error)]
pub enum TxidIndexerError {
    #[error("Syncer error: {0}")]
    SyncerError(#[from] SyncerError),
    #[error("POI client error: {0}")]
    PoiClient(#[from] PoiClientError),
    #[error("TXID tree root mismatch for tree {tree_number}")]
    RootMismatch { tree_number: u32 },
}

impl TxidIndexer {
    pub fn new(txid_syncer: Arc<dyn TransactionSyncer>) -> Self {
        TxidIndexer {
            trees: HashMap::new(),
            pending: VecDeque::new(),
            txid_to_utxo_pos: HashMap::new(),
            txid_to_txid_pos: HashMap::new(),
            synced_block: 0,
            txid_syncer,
        }
    }

    pub fn set_state(&mut self, state: TxidIndexerState) {
        self.trees = state
            .trees
            .into_iter()
            .map(|(k, v)| (k, TxidMerkleTree::from_state(v)))
            .collect();
        self.pending = state.pending.into_iter().collect();
        self.txid_to_utxo_pos = state.txid_to_utxo_position;
        self.txid_to_txid_pos = state.txid_to_txid_position;
        self.synced_block = state.synced_block;
    }

    pub fn state(&self) -> TxidIndexerState {
        TxidIndexerState {
            trees: self.trees.iter().map(|(k, v)| (*k, v.state())).collect(),
            pending: self.pending.iter().cloned().collect(),
            txid_to_utxo_position: self.txid_to_utxo_pos.clone(),
            txid_to_txid_position: self.txid_to_txid_pos.clone(),
            synced_block: self.synced_block,
        }
    }

    pub fn tree(&self, tree_number: u32) -> Option<&TxidMerkleTree> {
        self.trees.get(&tree_number)
    }

    pub fn txid_position(&self, txid: &Txid) -> Option<(u32, u32)> {
        self.txid_to_txid_pos.get(txid).cloned()
    }

    pub fn utxo_position(&self, txid: &Txid) -> Option<(u32, u32)> {
        self.txid_to_utxo_pos.get(txid).cloned()
    }

    pub async fn sync(&mut self, poi_client: &impl PoiNodeClient) -> Result<(), TxidIndexerError> {
        self.sync_to(u64::MAX, poi_client).await
    }

    #[tracing::instrument(name = "txid_sync", skip_all)]
    pub async fn sync_to(
        &mut self,
        to_block: u64,
        poi_client: &impl PoiNodeClient,
    ) -> Result<(), TxidIndexerError> {
        let from_block = self.synced_block + 1;

        let syncer = self.txid_syncer.clone();
        let latest_block = syncer.latest_block().await?;
        let to_block = to_block.min(latest_block);

        let ops = syncer.sync(from_block, to_block).await?;
        info!("Fetched {} operations from syncer", ops.len());
        for op in ops {
            self.pending.push_back(op);
        }
        self.synced_block = to_block;

        self.update(poi_client).await?;
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

        let drain_count = to_drain.min(self.pending.len());
        let drained: Vec<_> = self.pending.drain(..drain_count).collect();

        let mut total = current_total;
        for op in drained {
            let txid = Txid::new(&op.nullifiers, &op.commitment_hashes, op.bound_params_hash);

            if let Some(&existing_pos) = self.txid_to_txid_pos.get(&txid) {
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

            self.txid_to_txid_pos
                .insert(txid, (tree_number, position as u32));
            self.txid_to_utxo_pos
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

    pub fn reset(&mut self) {
        self.trees.clear();
        self.pending.clear();
        self.txid_to_utxo_pos.clear();
        self.txid_to_txid_pos.clear();
        self.synced_block = 0;
    }
}
