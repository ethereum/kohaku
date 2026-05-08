use alloy::primitives::Address;
use crypto::merkle_tree::MerkleTreeError;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{merkle::TornadoMerkleTree, note::Note};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawCircuitInputs {
    #[serde(rename = "root")]
    pub merkle_root: U256,
    pub nullifier_hash: U256,
    pub recipient: U256,
    pub relayer: U256,
    pub fee: U256,
    pub refund: U256,
    pub nullifier: U256,
    pub secret: U256,
    pub path_elements: Vec<U256>,
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
