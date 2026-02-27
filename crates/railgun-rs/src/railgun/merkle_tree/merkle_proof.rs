use crypto::poseidon_hash;
use ruint::aliases::U256;

use crate::railgun::merkle_tree::merkle_tree::MerkleProof;

/// Creates a deterministic proof for a given Txid leaf. This proof is
/// used when computing inputs for the POI circuit, where we need a Txid leaf
/// for a txid that has not yet been submitted on-chain (and consequentially
/// has not been added to the TXID merkle tree).
pub fn new_pre_inclusion(element: U256) -> MerkleProof {
    new_deterministic(element)
}

/// Creates a deterministic proof with a given element where the proof path is all zeros.
fn new_deterministic(element: U256) -> MerkleProof {
    let indices = U256::ZERO;
    let elements = [U256::ZERO; 16].to_vec();

    let mut root = element;
    for e in elements.iter() {
        root = poseidon_hash(&[root, *e]).unwrap();
    }

    MerkleProof::new(element, elements, indices, root.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::railgun::merkle_tree::MerkleRoot;

    #[test]
    fn test_serialize_deserialize() {
        let proof = MerkleProof::new(
            U256::from(123),
            vec![U256::from(456), U256::from(789)],
            U256::from(3),
            MerkleRoot::new(U256::from(999)),
        );

        let serialized = serde_json::to_string(&proof).unwrap();
        insta::assert_debug_snapshot!(serialized);

        let deserialized: MerkleProof = serde_json::from_str(&serialized).unwrap();

        assert_eq!(proof, deserialized);
    }
}
