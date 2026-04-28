use std::collections::HashMap;

use crate::railgun::{merkle_tree::MerkleProof, note::utxo::UtxoNote, poi::types::ListKey};

#[derive(Clone)]
pub struct PoiNote {
    pub inner: UtxoNote,
    pub pois: HashMap<ListKey, MerkleProof>,
}

impl PoiNote {
    pub fn new(note: UtxoNote, pois: HashMap<ListKey, MerkleProof>) -> Self {
        Self { inner: note, pois }
    }
}
