use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use crate::railgun::merkle_tree::{
    MerkleProof, MerkleRoot, MerkleTree, MerkleTreeError, MerkleTreeState,
};

/// UTXO trees track the state of all notes in Railgun. New UTXOs are added as
/// leaves whenever new commitments are observed from the Railgun smart contracts.
pub struct UtxoMerkleTree {
    inner: MerkleTree,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
pub struct UtxoLeafHash(U256);

impl UtxoMerkleTree {
    pub fn new(number: u32) -> Self {
        UtxoMerkleTree {
            inner: MerkleTree::new(number),
        }
    }

    pub fn from_state(state: MerkleTreeState) -> Self {
        UtxoMerkleTree {
            inner: MerkleTree::from_state(state),
        }
    }

    pub fn number(&self) -> u32 {
        self.inner.number()
    }

    pub fn root(&self) -> MerkleRoot {
        self.inner.root()
    }

    pub fn leaves_len(&self) -> usize {
        self.inner.leaves_len()
    }

    pub fn state(&self) -> MerkleTreeState {
        self.inner.state()
    }

    pub fn into_state(self) -> MerkleTreeState {
        self.inner.into_state()
    }

    pub fn generate_proof(&self, leaf: UtxoLeafHash) -> Result<MerkleProof, MerkleTreeError> {
        self.inner.generate_proof(leaf.into())
    }

    /// Insert one UTXO leaf and immediately rebuild.
    pub fn insert_leaf(&mut self, leaf: UtxoLeafHash, position: usize) {
        self.inner.insert_leaf(leaf.into(), position);
    }

    /// Insert leaves without rebuilding.
    pub fn insert_leaves_raw(&mut self, leaves: &[UtxoLeafHash], start_position: usize) {
        let u256s: Vec<U256> = leaves.iter().map(|l| (*l).into()).collect();
        self.inner.insert_leaves_raw(&u256s, start_position);
    }

    pub fn rebuild(&mut self) {
        self.inner.rebuild();
    }
}

impl From<U256> for UtxoLeafHash {
    fn from(value: U256) -> Self {
        UtxoLeafHash(value)
    }
}

impl From<UtxoLeafHash> for U256 {
    fn from(value: UtxoLeafHash) -> Self {
        value.0
    }
}
