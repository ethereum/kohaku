use std::fmt::Display;

use alloy::primitives::FixedBytes;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use crate::merkle_tree::{
    config::MerkleConfig,
    hex_u256::{u256_hex, vec_u256_hex},
};

#[derive(Debug, Copy, Clone, Eq, PartialEq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct MerkleRoot(#[serde(with = "u256_hex")] U256);

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct MerkleProof<C: MerkleConfig> {
    /// The leaf element
    #[serde(rename = "leaf", with = "u256_hex")]
    pub element: U256,
    /// Sibling elements along the proof path
    #[serde(with = "vec_u256_hex")]
    pub elements: Vec<U256>,
    /// Bit-packed indices of the proof path
    #[serde(with = "u256_hex")]
    pub indices: U256,
    /// The expected Merkle root
    pub root: MerkleRoot,

    #[serde(skip)]
    phantom: std::marker::PhantomData<C>,
}

impl MerkleRoot {
    pub fn new(root: U256) -> Self {
        MerkleRoot(root)
    }
}

impl<C: MerkleConfig> MerkleProof<C> {
    pub fn new(element: U256, elements: Vec<U256>, indices: U256, root: MerkleRoot) -> Self {
        Self {
            element,
            elements,
            indices,
            root,
            phantom: std::marker::PhantomData,
        }
    }

    pub fn verify(&self) -> bool {
        let mut indices_bits = Vec::new();
        let mut idx: u32 = self.indices.saturating_to();
        for _ in 0..self.elements.len() {
            indices_bits.push(idx & 1);
            idx >>= 1;
        }

        let mut current_hash = self.element;

        for (i, &sibling) in self.elements.iter().enumerate() {
            let is_left_child = indices_bits[i] == 0;
            current_hash = if is_left_child {
                C::hash(current_hash, sibling).into()
            } else {
                C::hash(sibling, current_hash).into()
            };
        }

        let current_hash: MerkleRoot = current_hash.into();
        current_hash == self.root
    }
}

impl From<U256> for MerkleRoot {
    fn from(value: U256) -> Self {
        MerkleRoot(value)
    }
}

impl From<MerkleRoot> for U256 {
    fn from(value: MerkleRoot) -> Self {
        value.0
    }
}

impl From<MerkleRoot> for FixedBytes<32> {
    fn from(value: MerkleRoot) -> Self {
        value.0.into()
    }
}

impl From<FixedBytes<32>> for MerkleRoot {
    fn from(value: FixedBytes<32>) -> Self {
        MerkleRoot(value.into())
    }
}

impl prover::IntoU256 for MerkleRoot {
    fn into_u256(self) -> U256 {
        self.0
    }
}

impl prover::FromU256 for MerkleRoot {
    fn from_u256(value: U256) -> Self {
        MerkleRoot(value)
    }
}

impl Display for MerkleRoot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:064x}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle_tree::config::TestMerkleConfig;

    #[test]
    fn test_serialize_deserialize() {
        let proof = MerkleProof::<TestMerkleConfig>::new(
            U256::from(123),
            vec![U256::from(456), U256::from(789)],
            U256::from(3),
            MerkleRoot(U256::from(999)),
        );

        let serialized = serde_json::to_string(&proof).unwrap();
        insta::assert_debug_snapshot!(serialized);

        let deserialized: MerkleProof<TestMerkleConfig> =
            serde_json::from_str(&serialized).unwrap();

        assert_eq!(proof, deserialized);
    }
}
