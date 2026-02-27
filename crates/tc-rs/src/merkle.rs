use std::sync::OnceLock;

use alloy::primitives::utils::keccak256_cached;
use ark_bn254::Fr;
use ark_ff::{BigInt, PrimeField};
use crypto::{merkle_tree::MerkleConfig, mimc_sponge_hash};
use ruint::{aliases::U256, uint};

const FIELD_SIZE: U256 =
    uint!(21888242871839275222246405745257275088548364400416034343698204186575808495617_U256);

/// TC's Merkle tree parameters: depth 20, MiMC sponge hash, keccak256("tornado") zero leaf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TornadoMerkleConfig;

impl MerkleConfig for TornadoMerkleConfig {
    const DEPTH: usize = 20;

    fn hash(left: U256, right: U256) -> U256 {
        let l: Fr = BigInt::from(left).into();
        let r: Fr = BigInt::from(right).into();
        mimc_sponge_hash(l, r).into_bigint().into()
    }

    /// keccak256("tornado") % FIELD_SIZE.
    fn zero() -> U256 {
        static ZERO: OnceLock<U256> = OnceLock::new();
        *ZERO.get_or_init(|| {
            let hash = keccak256_cached(b"tornado");
            let hash_u256 = U256::from_be_bytes(*hash);
            hash_u256 % FIELD_SIZE
        })
    }
}

pub type TornadoMerkleTree = crypto::merkle_tree::MerkleTree<TornadoMerkleConfig>;
pub use crypto::merkle_tree::{MerkleProof, MerkleRoot};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero() {
        // This test just ensures the zero leaf is consistent with the JS implementation.
        let expected_zero = uint!(
            21663839004416932945382355908790599225266501822907911457504978515578255421292_U256
        );
        assert_eq!(TornadoMerkleConfig::zero(), expected_zero);
    }

    #[test]
    fn test_zero_root() {
        // This test ensures the root of an empty tree is consistent with the JS implementation.
        let tree = TornadoMerkleTree::new(0);
        let expected_root = uint!(
            18926336163373752588529320804722226672465218465546337267825102089394393880276_U256
        );
        let root: U256 = tree.root().into();
        assert_eq!(root, expected_root);
    }
}
