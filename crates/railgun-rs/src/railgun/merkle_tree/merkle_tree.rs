use alloy::primitives::utils::keccak256_cached;
use crypto::{merkle_tree::MerkleConfig, poseidon_hash};
use ruint::aliases::U256;

use crate::crypto::railgun_zero::SNARK_PRIME;

pub const TREE_DEPTH: usize = 16;
pub const TOTAL_LEAVES: usize = 1 << TREE_DEPTH;

pub type MerkleTree = crypto::merkle_tree::MerkleTree<RailgunMerkleConfig>;
pub type MerkleTreeState = crypto::merkle_tree::MerkleTreeState<RailgunMerkleConfig>;
pub type MerkleProof = crypto::merkle_tree::MerkleProof<RailgunMerkleConfig>;
pub type MerkleTreeError = crypto::merkle_tree::MerkleTreeError;
pub type MerkleRoot = crypto::merkle_tree::MerkleRoot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RailgunMerkleConfig;

impl MerkleConfig for RailgunMerkleConfig {
    const DEPTH: usize = TREE_DEPTH;

    fn hash(left: U256, right: U256) -> U256 {
        poseidon_hash(&[left, right]).unwrap()
    }

    fn zero() -> U256 {
        let hash = U256::from_be_bytes(*keccak256_cached(b"Railgun"));
        hash % SNARK_PRIME
    }
}

#[cfg(test)]
mod tests {
    use ruint::uint;
    use tracing_test::traced_test;

    use super::*;

    #[test]
    fn test_railgun_merkle_tree_zero() {
        let zero = RailgunMerkleConfig::zero();
        let expected = uint!(
            2051258411002736885948763699317990061539314419500486054347250703186609807356_U256
        );
        assert_eq!(zero, expected);
    }

    #[test]
    #[traced_test]
    fn test_empty_merkleroot() {
        let tree = MerkleTree::new(0);
        let expected_root: MerkleRoot = uint!(
            9493149700940509817378043077993653487291699154667385859234945399563579865744_U256
        )
        .into();

        assert_eq!(tree.root(), expected_root);
    }

    #[test]
    #[traced_test]
    fn test_merkle_tree_insert_and_proof() {
        let mut tree = MerkleTree::new(0);
        let leaves: Vec<U256> = (0..10u64).map(|i| U256::from(i + 1)).collect();
        let expected_root: MerkleRoot = uint!(
            13360826432759445967430837006844965422592495092152969583910134058984357610665_U256
        )
        .into();

        tree.insert_leaves_raw(&leaves, 0);
        tree.rebuild();

        let root = tree.root();
        assert_eq!(root, expected_root);

        for &leaf in &leaves {
            let proof = tree.generate_proof(leaf).unwrap();
            assert!(proof.verify(), "Proof invalid for leaf: {:?}", leaf);
        }

        let tree_leaves_len = tree.leaves_len();
        assert_eq!(tree_leaves_len, leaves.len());
    }

    #[test]
    #[traced_test]
    fn test_state() {
        let mut tree = MerkleTree::new(0);
        let leaves: Vec<U256> = (0..10u64).map(|i| U256::from(i + 1)).collect();
        tree.insert_leaves_raw(&leaves, 0);
        tree.rebuild();

        let state = tree.state();
        let rebuilt_tree = MerkleTree::from_state(state);

        assert_eq!(tree.root(), rebuilt_tree.root());
    }
}
