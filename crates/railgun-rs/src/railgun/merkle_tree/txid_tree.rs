use crypto::poseidon_hash;
use ruint::aliases::U256;
use serde::{Serialize, Serializer};

use crate::{
    crypto::railgun_txid::Txid,
    railgun::merkle_tree::{
        MerkleProof, MerkleRoot, MerkleTree, MerkleTreeError, MerkleTreeState, TOTAL_LEAVES,
    },
};

/// TxID tree tracks all Operations (`RailgunSmartWallet::Transaction`) in Railgun.
/// Each TxID coresponds to multiple UTXO operations.
///
/// TxID proofs are used to generate Merkle proofs for TxIDs when submitting to
/// POI nodes.
pub struct TxidMerkleTree {
    inner: MerkleTree,
}

/// Txid leaf hash.  Dependant on the TxID and the position of the TxID in the
/// UTXO tree.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
pub struct TxidLeafHash(U256);

/// Global index of a TxID leaf in the UTXO tree.
///
/// Pre-inclusion TxIDs use the pre-inclusion constants. They are used when
/// generating POI circuit inputs and submitting to broadcasters.
///
/// Included TxIDs have defined positions based on the index of their first UTXO
/// note in the on-chain UTXO tree. They are used when submitting to POI nodes.
#[derive(Debug, Clone, Copy)]
pub enum UtxoTreeIndex {
    /// Transactions that have been generated but not yet included on-chain (
    /// IE those being prepared for POI proof generation) use the pre-inclusion
    /// constants.
    PreInclusion,
    /// Transactions that have been included in the UTXO merkle tree (IE those
    /// that have been submitted on-chain to the RailgunSmartWallet) will have a
    /// defined position in the tree.
    Included { tree_number: u32, start_index: u32 },
    /// Transactions that only involve unshielding (IE those with no commitments)
    /// do not add any leaves to the UTXO tree, so they use the unshield-only constants.
    UnshieldOnly,
}

const GLOBAL_UTXO_TREE_UNSHIELD_EVENT_HARDCODED_VALUE: u64 = 99999;
const GLOBAL_UTXO_POSITION_UNSHIELD_EVENT_HARDCODED_VALUE: u64 = 99999;
const GLOBAL_UTXO_TREE_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE: u64 = 199999;
const GLOBAL_UTXO_POSITION_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE: u64 = 199999;

impl TxidMerkleTree {
    pub fn new(number: u32) -> Self {
        TxidMerkleTree {
            inner: MerkleTree::new(number),
        }
    }

    pub fn from_state(state: MerkleTreeState) -> Self {
        TxidMerkleTree {
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

    pub fn generate_proof(&self, leaf: TxidLeafHash) -> Result<MerkleProof, MerkleTreeError> {
        self.inner.generate_proof(leaf.into())
    }

    /// Insert one TxID leaf and immediately rebuild.
    pub fn insert_leaf(&mut self, leaf: TxidLeafHash, position: usize) {
        self.inner.insert_leaf(leaf.into(), position);
    }

    /// Insert leaves without immediately rebuilding.
    pub(crate) fn insert_leaves(&mut self, leaves: &[TxidLeafHash], start_position: usize) {
        let u256s: Vec<U256> = leaves.iter().map(|l| (*l).into()).collect();
        self.inner.insert_leaves_raw(&u256s, start_position);
    }

    pub fn rebuild(&mut self) {
        self.inner.rebuild();
    }
}

impl TxidLeafHash {
    pub fn new(txid: Txid, utxo_tree_in: u32, out_utxo_tree_index: UtxoTreeIndex) -> Self {
        let global_position = out_utxo_tree_index.global_index();

        poseidon_hash(&[
            txid.into(),
            U256::from(utxo_tree_in),
            U256::from(global_position),
        ])
        .unwrap()
        .into()
    }
}

impl From<U256> for TxidLeafHash {
    fn from(value: U256) -> Self {
        TxidLeafHash(value)
    }
}

impl From<TxidLeafHash> for U256 {
    fn from(value: TxidLeafHash) -> Self {
        value.0
    }
}

impl Serialize for TxidLeafHash {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&format!("{:064x}", self.0))
    }
}

impl UtxoTreeIndex {
    pub fn included(tree_number: u32, start_index: u32) -> Self {
        UtxoTreeIndex::Included {
            tree_number,
            start_index,
        }
    }

    pub fn pre_inclusion() -> Self {
        UtxoTreeIndex::PreInclusion
    }

    pub fn unshield_only() -> Self {
        UtxoTreeIndex::UnshieldOnly
    }

    pub fn global_index(&self) -> u64 {
        let (tree_number, start_index) = match self {
            UtxoTreeIndex::Included {
                tree_number,
                start_index,
            } => (*tree_number as u64, *start_index as u64),
            UtxoTreeIndex::PreInclusion => (
                GLOBAL_UTXO_TREE_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
                GLOBAL_UTXO_POSITION_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
            ),
            UtxoTreeIndex::UnshieldOnly => (
                GLOBAL_UTXO_TREE_UNSHIELD_EVENT_HARDCODED_VALUE,
                GLOBAL_UTXO_POSITION_UNSHIELD_EVENT_HARDCODED_VALUE,
            ),
        };

        tree_number * (TOTAL_LEAVES as u64) + start_index
    }
}
