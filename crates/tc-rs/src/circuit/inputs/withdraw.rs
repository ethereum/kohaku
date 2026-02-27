use alloy::primitives::Address;
use crypto::merkle_tree::MerkleTreeError;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    circuit::inputs::decimal_u256::{u256_decimal, vec_u256_decimal},
    merkle::TornadoMerkleTree,
    note::Note,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct WithdrawCircuitInputs {
    #[serde(rename = "root", with = "u256_decimal")]
    pub merkle_root: U256,
    #[serde(rename = "nullifierHash", with = "u256_decimal")]
    pub nullifier_hash: U256,
    #[serde(rename = "recipient", with = "u256_decimal")]
    pub recipient: U256,
    #[serde(rename = "relayer", with = "u256_decimal")]
    pub relayer: U256,
    #[serde(rename = "fee", with = "u256_decimal")]
    pub fee: U256,
    #[serde(rename = "refund", with = "u256_decimal")]
    pub refund: U256,
    #[serde(rename = "nullifier", with = "u256_decimal")]
    pub nullifier: U256,
    #[serde(rename = "secret", with = "u256_decimal")]
    pub secret: U256,
    #[serde(rename = "pathElements", with = "vec_u256_decimal")]
    pub path_elements: Vec<U256>,
    #[serde(rename = "pathIndices", with = "vec_u256_decimal")]
    pub path_indices: Vec<U256>,
}

#[derive(Debug, Error)]
pub enum WithdrawCircuitInputsError {
    #[error("Merkle tree error: {0}")]
    MerkleTree(#[from] MerkleTreeError),
}

impl WithdrawCircuitInputs {
    pub fn new(
        merkle_tree: &TornadoMerkleTree,
        note: &Note,
        recipient: Address,
        relayer: Address,
        fee: U256,
        refund: U256,
    ) -> Result<Self, WithdrawCircuitInputsError> {
        let merkle_root = merkle_tree.root().into();
        let nullifier_hash = note.nullifier_hash().into();
        let recipient = recipient.into_word().into();
        let relayer = relayer.into_word().into();

        let nullifier = U256::from_le_slice(&note.nullifier);
        let secret = U256::from_le_slice(&note.secret);

        let proof = merkle_tree.generate_proof(note.commitment())?;
        let mut path_elements = vec![U256::ZERO; 20];
        let mut path_indices = vec![U256::ZERO; 20];

        for (i, element) in proof.elements.iter().enumerate() {
            path_elements[i] = (*element).into();
        }
        for i in 0..20 {
            path_indices[i] = if proof.indices.bit(i) {
                U256::from(1)
            } else {
                U256::ZERO
            };
        }

        Ok(Self {
            merkle_root,
            nullifier_hash,
            recipient,
            relayer,
            fee,
            refund,
            nullifier,
            secret,
            path_elements,
            path_indices,
        })
    }

    prover::circuit_inputs!(
        merkle_root => "root",
        nullifier_hash => "nullifierHash",
        recipient => "recipient",
        relayer => "relayer",
        fee => "fee",
        refund => "refund",
        nullifier => "nullifier",
        secret => "secret",
        path_elements => "pathElements",
        path_indices => "pathIndices"
    );
}
