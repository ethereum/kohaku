use std::{collections::HashMap, sync::Arc};

use crypto::poseidon_hash;
use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    caip::AssetId,
    crypto::keys::U256Key,
    railgun::{
        RailgunSigner, RailgunSignerError,
        merkle_tree::{MerkleRoot, MerkleTreeError, UtxoMerkleTree},
        note::{Note, utxo::UtxoNote},
    },
};

#[derive(Debug, Clone)]
pub struct TransactCircuitInputs {
    // Public Inputs
    pub merkleroot: MerkleRoot,
    pub bound_params_hash: U256,
    pub nullifiers: Vec<U256>,
    pub commitments_out: Vec<U256>,

    // Private Inputs
    token: U256,
    public_key: [U256; 2],
    signature: [U256; 3],
    random_in: Vec<U256>,
    value_in: Vec<U256>,
    path_elements: Vec<Vec<U256>>,
    leaves_indices: Vec<U256>,
    nullifying_key: U256,
    npk_out: Vec<U256>,
    value_out: Vec<U256>,
}

#[derive(Debug, Error)]
pub enum TransactCircuitInputsError {
    #[error("Empty input notes")]
    EmptyInputNotes,
    #[error("Merkle tree error: {0}")]
    MerkleTree(#[from] MerkleTreeError),
    #[error("Signing error: {0}")]
    Signing(#[from] RailgunSignerError),
}

impl TransactCircuitInputs {
    pub fn from_inputs(
        merkle_tree: &UtxoMerkleTree,
        bound_params_hash: U256,
        signer: Arc<dyn RailgunSigner>,
        asset: AssetId,
        notes_in: &[UtxoNote],
        notes_out: &[Box<dyn Note>],
    ) -> Result<Self, TransactCircuitInputsError> {
        if notes_in.is_empty() || notes_out.is_empty() {
            return Err(TransactCircuitInputsError::EmptyInputNotes);
        }

        let merkleroot = merkle_tree.root();
        let merkle_proofs: Vec<_> = notes_in
            .iter()
            .map(|note| merkle_tree.generate_proof(note.hash()))
            .collect::<Result<_, _>>()?;

        let nullifiers: Vec<U256> = notes_in.iter().map(|note| note.nullifier).collect();
        let commitments: Vec<U256> = notes_out.iter().map(|note| note.hash().into()).collect();

        let token = asset.hash();
        let public_key = signer.spending_key().public_key();
        let public_key = [public_key.x_u256(), public_key.y_u256()];

        let mut unsigned = vec![merkleroot.into(), bound_params_hash];
        unsigned.extend_from_slice(&nullifiers);
        unsigned.extend_from_slice(&commitments);
        let unsigned_hash = poseidon_hash(&unsigned).unwrap();
        let signature = signer.sign(unsigned_hash)?;
        let signature = [signature.r8_x, signature.r8_y, signature.s];

        let random_in = notes_in
            .iter()
            .map(|note| U256::from_be_slice(&note.random))
            .collect();

        let value_in = notes_in
            .iter()
            .map(|note| U256::from(note.value()))
            .collect();

        let path_elements = merkle_proofs.iter().map(|p| p.elements.clone()).collect();

        let leaves_indices = merkle_proofs
            .iter()
            .map(|p| U256::from(p.indices))
            .collect();

        let nullifying_key = signer.viewing_key().nullifying_key().to_u256();
        let npk_out = notes_out
            .iter()
            .map(|note| note.note_public_key())
            .collect();
        let value_out = notes_out
            .iter()
            .map(|note| U256::from(note.value()))
            .collect();

        Ok(TransactCircuitInputs {
            merkleroot,
            bound_params_hash,
            nullifiers,
            commitments_out: commitments,
            token,
            public_key,
            signature,
            random_in,
            value_in,
            path_elements,
            leaves_indices,
            nullifying_key,
            npk_out,
            value_out,
        })
    }

    pub fn to_circuit_signals(&self) -> HashMap<String, Vec<U256>> {
        let mut m = HashMap::with_capacity(14);
        m.insert("merkleRoot".into(), vec![self.merkleroot.into()]);
        m.insert("boundParamsHash".into(), vec![self.bound_params_hash]);
        m.insert("nullifiers".into(), self.nullifiers.clone());
        m.insert("commitmentsOut".into(), self.commitments_out.clone());
        m.insert("token".into(), vec![self.token]);
        m.insert("publicKey".into(), self.public_key.to_vec());
        m.insert("signature".into(), self.signature.to_vec());
        m.insert("randomIn".into(), self.random_in.clone());
        m.insert("valueIn".into(), self.value_in.clone());
        m.insert(
            "pathElements".into(),
            self.path_elements.iter().flatten().copied().collect(),
        );
        m.insert("leavesIndices".into(), self.leaves_indices.clone());
        m.insert("nullifyingKey".into(), vec![self.nullifying_key]);
        m.insert("npkOut".into(), self.npk_out.clone());
        m.insert("valueOut".into(), self.value_out.clone());
        m
    }
}
