use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    caip::AssetId,
    chain_config::ChainConfig,
    railgun::{
        address::RailgunAddress,
        indexer::{
            syncer::{NoteSyncer, TransactionSyncer},
            txid_indexer::{TxidIndexer, TxidIndexerError, TxidIndexerState},
            utxo_indexer::{UtxoIndexer, UtxoIndexerError, UtxoIndexerState},
        },
        merkle_tree::{UtxoMerkleTree, verifier::MerkleTreeVerifier},
        note::utxo::UtxoNote,
        poi::PoiClient,
    },
};

/// Combo indexer that maintains both UTXO and TXID indexes.
pub struct Indexer {
    utxo_indexer: UtxoIndexer,
    txid_indexer: TxidIndexer,
}

#[derive(Serialize, Deserialize)]
pub struct IndexerState {
    pub utxo_state: UtxoIndexerState,
    pub txid_state: TxidIndexerState,
}

#[derive(Debug, Error)]
pub enum IndexerError {
    #[error("UTXO error: {0}")]
    Utxo(#[from] UtxoIndexerError),
    #[error("TXID error: {0}")]
    Txid(#[from] TxidIndexerError),
}

impl Indexer {
    pub fn new(
        utxo_syncer: Arc<dyn NoteSyncer>,
        txid_syncer: Arc<dyn TransactionSyncer>,
        utxo_verifier: Arc<dyn MerkleTreeVerifier>,
        poi_client: PoiClient,
    ) -> Self {
        let utxo_indexer = UtxoIndexer::new(utxo_syncer, utxo_verifier);
        let txid_indexer = TxidIndexer::new(txid_syncer, poi_client);
        Self::from_indexers(utxo_indexer, txid_indexer)
    }

    pub fn from_indexers(utxo_indexer: UtxoIndexer, txid_indexer: TxidIndexer) -> Self {
        Indexer {
            utxo_indexer,
            txid_indexer,
        }
    }

    pub fn from_state(
        utxo_syncer: Arc<dyn NoteSyncer>,
        utxo_verifier: Arc<dyn MerkleTreeVerifier>,
        txid_syncer: Arc<dyn TransactionSyncer>,
        poi_client: PoiClient,
        state: IndexerState,
    ) -> Self {
        let utxo_indexer = UtxoIndexer::from_state(utxo_syncer, utxo_verifier, state.utxo_state);
        let txid_indexer = TxidIndexer::from_state(txid_syncer, poi_client, state.txid_state);
        Self::from_indexers(utxo_indexer, txid_indexer)
    }

    pub fn state(&self) -> IndexerState {
        IndexerState {
            utxo_state: self.utxo_indexer.state(),
            txid_state: self.txid_indexer.state(),
        }
    }

    pub fn all_unspent(&self) -> Vec<UtxoNote> {
        self.utxo_indexer.all_unspent()
    }

    pub fn balance(&self, address: RailgunAddress) -> HashMap<AssetId, u128> {
        self.utxo_indexer.balance(address)
    }

    pub fn utxo_trees(&self) -> &BTreeMap<u32, UtxoMerkleTree> {
        &self.utxo_indexer.utxo_trees
    }

    pub fn utxo_trees_mut(&mut self) -> &mut BTreeMap<u32, UtxoMerkleTree> {
        &mut self.utxo_indexer.utxo_trees
    }
}
