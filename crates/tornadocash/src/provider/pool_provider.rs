use std::sync::Arc;

use alloy::{
    primitives::{Address, Bytes},
    sol_types::SolCall,
};
use anyhow::Context;
use rand::CryptoRng;
use ruint::aliases::U256;
use tracing::info;
use websnark_rs::{
    circuit::generate_witness,
    proof::{Proof, generate_random_proof},
};

use crate::{
    abis::tornado::Tornado,
    circuit::{artifacts::RemoteArtifactLoader, input::CircuitInputs},
    indexer::{
        indexer::{Indexer, IndexerError},
        syncer::Syncer,
        verifier::Verifier,
    },
    provider::{
        note::Note,
        pool::{Asset, Pool},
    },
};

/// A provider for a single tornadocash pool.
///
/// The provider manages syncing and verifying the trie state, generating merkle proofs, and
/// creating deposit and withdrawal transactions.
pub struct PoolProvider {
    indexer: Indexer,
    artifact_loader: RemoteArtifactLoader,
}

#[derive(Debug, Clone)]
pub struct TxData {
    pub to: Address,
    pub data: Bytes,
    pub value: U256,
}

#[derive(Debug, thiserror::Error)]
pub enum PoolProviderError {
    #[error("Invalid amount for pool: {0} != {1}")]
    InvalidAmount(String, String),
    #[error("Invalid symbol for pool: {0} != {1}")]
    InvalidSymbol(String, String),
    #[error("Indexer error: {0}")]
    Indexer(#[from] IndexerError),
    #[error("Merkle proof generation error: {0}")]
    MerkleProof(#[from] crypto::merkle_tree::MerkleTreeError),
    #[error("Circuit error: {0}")]
    Circuit(#[from] websnark_rs::circuit::CircuitError),
    #[error("Proof generation error: {0}")]
    Proof(#[from] websnark_rs::proof::ProofError),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl PoolProvider {
    pub fn new(pool: Pool, syncer: Arc<dyn Syncer>, verifier: Arc<dyn Verifier>) -> Self {
        let artifact_loader = RemoteArtifactLoader::default();
        let indexer = Indexer::new(pool, syncer, verifier);
        Self {
            indexer,
            artifact_loader,
        }
    }

    /// Get the pool associated with this provider.
    pub fn pool(&self) -> &Pool {
        self.indexer.pool()
    }

    /// Sync the provider to the latest block and verify the tree state.
    pub async fn sync(&mut self) -> Result<(), PoolProviderError> {
        self.indexer.sync().await?;
        self.verify().await
    }

    /// Sync the provider to a specific block.
    ///
    /// Will not verify the tree state after syncing because tornadocash
    /// only stores the merkle root for the past ~100 blocks.
    pub async fn sync_to(&mut self, block: u64) -> Result<(), PoolProviderError> {
        Ok(self.indexer.sync_to(block).await?)
    }

    /// Verify the tree state of the provider.
    pub async fn verify(&self) -> Result<(), PoolProviderError> {
        Ok(self.indexer.verify().await?)
    }

    /// Create a deposit transaction and note for this pool.
    pub fn deposit(&self, rng: &mut impl CryptoRng) -> (TxData, Note) {
        let note = Note::random(
            &self.pool().symbol(),
            &self.pool().amount(),
            self.pool().chain_id,
            rng,
        );

        let calldata = Tornado::depositCall {
            _commitment: note.commitment().into(),
        }
        .abi_encode();
        let value = match self.pool().asset {
            Asset::Native { .. } => self.pool().amount_wei,
            Asset::Erc20 { .. } => 0,
        };

        let tx_data = TxData {
            to: self.pool().address,
            data: calldata.into(),
            value: U256::from(value),
        };
        (tx_data, note)
    }

    /// Create a withdrawal transaction for the given note to the recipient
    /// address.
    pub async fn withdraw(
        &self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
        rng: &mut impl CryptoRng,
    ) -> Result<TxData, PoolProviderError> {
        let call = self
            .withdraw_calldata(note, recipient, relayer, fee, refund, rng)
            .await?
            .abi_encode();

        Ok(TxData {
            to: self.pool().address,
            data: call.into(),
            value: refund.unwrap_or_default(),
        })
    }

    /// Create the calldata for a withdrawal transaction
    async fn withdraw_calldata(
        &self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
        rng: &mut impl CryptoRng,
    ) -> Result<Tornado::withdrawCall, PoolProviderError> {
        if note.amount != self.pool().amount() {
            return Err(PoolProviderError::InvalidAmount(
                note.amount.clone(),
                self.pool().amount(),
            ));
        }

        if note.symbol != self.pool().symbol() {
            return Err(PoolProviderError::InvalidSymbol(
                note.symbol.clone(),
                self.pool().symbol(),
            ));
        }

        let merkle_tree = self.indexer.tree();
        let root = merkle_tree.root().into();
        let nullifier_hash = note.nullifier_hash();
        let relayer = relayer.unwrap_or_default();
        let fee = fee.unwrap_or_default();
        let refund = refund.unwrap_or_default();

        let (path_elements, path_indices) = generate_merkle_proof(note, merkle_tree)?;
        info!(
            "Generated merkle proof for note: path_elements={:?}, path_indices={:?}",
            path_elements, path_indices
        );
        let circuit_inputs = CircuitInputs::new(
            root,
            nullifier_hash,
            U256::from_be_slice(recipient.as_slice()),
            U256::from_be_slice(relayer.as_slice()),
            fee,
            refund,
            U256::from_le_slice(&note.nullifier),
            U256::from_le_slice(&note.secret),
            path_elements,
            path_indices,
        );

        let input_signals = circuit_inputs.as_signals();
        info!("Generated circuit inputs: {:?}", input_signals);

        let circuit = self
            .artifact_loader
            .load_circuit()
            .await
            .context("Error loading circuit")?;
        let proving_key = self
            .artifact_loader
            .load_proving_key()
            .await
            .context("Error loading proving key")?;

        let witness = generate_witness(circuit, input_signals)?;
        let (proof, _public_inputs) = generate_random_proof(proving_key, witness, rng)?;

        let proof = solidity_proof(&proof);
        let call = Tornado::withdrawCall {
            _proof: proof,
            _root: root.into(),
            _nullifierHash: nullifier_hash.into(),
            _recipient: recipient,
            _relayer: relayer,
            _fee: fee,
            _refund: refund,
        };

        Ok(call)
    }
}

/// Generate the merkle proof for a given note and merkle tree.
///
/// Returns (path elements, path indices)
fn generate_merkle_proof(
    note: &Note,
    merkle_tree: &crypto::merkle_tree::MerkleTree<crate::merkle::TornadoMerkleConfig>,
) -> Result<([U256; 20], [U256; 20]), PoolProviderError> {
    let proof = merkle_tree.generate_proof(note.commitment())?;
    let mut path_elements = [U256::ZERO; 20];
    let mut path_indices = [U256::ZERO; 20];

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
    Ok((path_elements, path_indices))
}

/// Convert a websnark proof into the format expected by the Solidity contract.
fn solidity_proof(proof: &Proof) -> Bytes {
    let proof_elements: [U256; 8] = [
        proof.a.x.into(),
        proof.a.y.into(),
        //? Order of b elements are reversed to match Solidity's expected format
        proof.b.x.c1.into(),
        proof.b.x.c0.into(),
        proof.b.y.c1.into(),
        proof.b.y.c0.into(),
        proof.c.x.into(),
        proof.c.y.into(),
    ];
    let mut proof_bytes = Vec::with_capacity(256);
    for elem in &proof_elements {
        proof_bytes.extend_from_slice(&elem.to_be_bytes::<32>());
    }

    proof_bytes.into()
}

// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[test]
//     fn test_
// }
