use std::sync::Arc;

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use crate::railgun::merkle_tree::{
    MerkleProof, MerkleRoot, MerkleTree, MerkleTreeError, MerkleTreeState, MerkleTreeVerifier,
    VerificationError,
};

/// UTXO trees track the state of all notes in Railgun. New UTXOs are added as
/// leaves whenever new commitments are observed from the Railgun smart contracts.
pub struct UtxoMerkleTree {
    inner: MerkleTree,
    verifier: Option<Arc<dyn MerkleTreeVerifier>>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
pub struct UtxoLeafHash(U256);

impl UtxoMerkleTree {
    pub fn new(number: u32) -> Self {
        UtxoMerkleTree {
            inner: MerkleTree::new(number),
            verifier: None,
        }
    }

    pub fn from_state(state: MerkleTreeState) -> Self {
        UtxoMerkleTree {
            inner: MerkleTree::from_state(state),
            verifier: None,
        }
    }

    pub fn with_verifier(mut self, verifier: Arc<dyn MerkleTreeVerifier>) -> Self {
        self.verifier = Some(verifier);
        self
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

    /// Validates this tree's root against the embedded verifier, if any.
    /// Returns `Ok(())` immediately if no verifier is set or the tree is empty.
    pub async fn verify(&self) -> Result<(), VerificationError> {
        let Some(verifier) = &self.verifier else {
            return Ok(());
        };

        let leaves_len = self.inner.leaves_len();
        if leaves_len == 0 {
            return Ok(());
        }

        let tree_number = self.inner.number();
        let tree_index = leaves_len as u64 - 1;
        let root = self.inner.root();

        verifier
            .verify_root(tree_number, tree_index, root)
            .await
            .map_err(VerificationError::VerifierError)
            .and_then(|valid| {
                if valid {
                    Ok(())
                } else {
                    Err(VerificationError::InvalidRoot { tree_number, root })
                }
            })
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
