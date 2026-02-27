use prover::circuit_inputs;
use ruint::aliases::U256;
use thiserror::Error;

use crate::railgun::{
    merkle_tree::{MerkleRoot, MerkleTreeError, UtxoMerkleTree},
    note::{IncludedNote, Note, SignableNote},
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
}

impl TransactCircuitInputs {
    pub fn from_inputs<N: IncludedNote + SignableNote>(
        merkle_tree: &UtxoMerkleTree,
        bound_params_hash: U256,
        notes_in: &[N],
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

        let nullifiers: Vec<U256> = notes_in
            .iter()
            .zip(merkle_proofs.iter())
            .map(|(note, proof)| note.nullifier(proof.indices))
            .collect();
        let commitments: Vec<U256> = notes_out.iter().map(|note| note.hash().into()).collect();

        let note_zero = &notes_in[0];
        let token = note_zero.asset().hash();
        let public_key = note_zero.spending_pubkey();
        let public_key = [public_key[0], public_key[1]];

        let mut unsigned = vec![merkleroot.into(), bound_params_hash];
        unsigned.extend_from_slice(&nullifiers);
        unsigned.extend_from_slice(&commitments);
        let signature = note_zero.sign(&unsigned);

        let random_in = notes_in
            .iter()
            .map(|note| U256::from_be_slice(&note.random()))
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

        let nullifying_key = note_zero.nullifying_key();
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

    circuit_inputs!(
        merkleroot => "merkleRoot",
        bound_params_hash => "boundParamsHash",
        nullifiers => "nullifiers",
        commitments_out => "commitmentsOut",
        token => "token",
        public_key => "publicKey",
        signature => "signature",
        random_in => "randomIn",
        value_in => "valueIn",
        path_elements => "pathElements",
        leaves_indices => "leavesIndices",
        nullifying_key => "nullifyingKey",
        npk_out => "npkOut",
        value_out => "valueOut"
    );
}
