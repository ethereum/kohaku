use std::{collections::HashMap, sync::Arc};

use alloy::primitives::ChainId;
use prover::{Prover, ProverError};
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

use crate::{
    circuit::{
        inputs::poi_inputs::{PoiCircuitInputs, PoiCircuitInputsError},
        prover::prove_poi,
    },
    crypto::{
        keys::{NullifyingKey, SpendingPublicKey},
        railgun_txid::Txid,
    },
    railgun::{
        indexer::{TransactionSyncer, TxidIndexer, TxidIndexerError, TxidIndexerState},
        merkle_tree::{MerkleProof, TOTAL_LEAVES, UtxoTreeIndex},
        note::utxo::{self, UtxoNote},
        poi::{
            BlindedCommitment, BlindedCommitmentType, ListKey, PoiNote, PoiStatus,
            client::{PoiClient, PoiClientError},
            types::TransactProofData,
        },
        transaction::ProvedOperation,
    },
};

pub struct PoiProvider {
    txid_indexer: TxidIndexer,
    poi_client: PoiClient,
    prover: Arc<dyn Prover>,
    pending: Vec<PendingPoiEntry>,
    pois: HashMap<BlindedCommitment, HashMap<ListKey, PoiInfo>>,
}

#[derive(Serialize, Deserialize)]
pub struct PoiProviderState {
    pub txid_indexer: TxidIndexerState,
    pub pending: Vec<PendingPoiEntry>,
    pub pois: HashMap<BlindedCommitment, HashMap<ListKey, PoiInfo>>,
}

#[derive(Debug, Error)]
pub enum PoiProviderError {
    #[error("Txid indexer error: {0}")]
    TxidIndexer(#[from] TxidIndexerError),
    #[error("POI Client error: {0}")]
    PoiClient(#[from] PoiClientError),
    #[error("Merkle proof not found for blinded commitment {0} and list key {1}")]
    ProofNotFound(BlindedCommitment, ListKey),
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct PoiInfo {
    status: Option<PoiStatus>,
    proof: Option<MerkleProof>,
}

/// Serializable snapshot needed to re-prove and submit a post-transaction POI
/// proof to the POI aggregator.
///
/// TODO: Consider privacy / security implications of storing this data on disk.
#[derive(Clone, Serialize, Deserialize)]
pub struct PendingPoiEntry {
    pub txid: Txid,
    pub spending_pubkey: SpendingPublicKey,
    pub nullifying_key: NullifyingKey,
    pub utxo_tree_in: u32,
    pub bound_params_hash: U256,
    /// Input UTXO notes. Fresh POI proofs are re-fetched at process time.
    pub in_notes: Vec<UtxoNote>,
    pub out_commitments: Vec<U256>,
    pub out_npks: Vec<U256>,
    pub out_values: Vec<U256>,
    pub token_hash: U256,
    pub has_unshield: bool,
    pub list_keys: Vec<ListKey>,
}

#[derive(Debug, Error)]
enum PendingPoiError {
    #[error("POI client error: {0}")]
    PoiClient(#[from] PoiClientError),
    #[error("Circuit inputs error: {0}")]
    CircuitInputs(#[from] PoiCircuitInputsError),
    #[error("Prover error: {0}")]
    Prover(#[from] ProverError),
    #[error("Missing UTXO tree {0}")]
    MissingUtxoTree(u32),
    #[error("Missing TXID tree {0}")]
    MissingTxidTree(u32),
}

impl PoiProvider {
    pub fn new(
        chain_id: ChainId,
        poi_endpoint: impl Into<String>,
        list_keys: Vec<ListKey>,
        prover: Arc<dyn Prover>,
        txid_syncer: Arc<dyn TransactionSyncer>,
    ) -> Self {
        Self {
            txid_indexer: TxidIndexer::new(txid_syncer),
            poi_client: PoiClient::new(chain_id, poi_endpoint, list_keys),
            prover,
            pending: Vec::new(),
            pois: HashMap::new(),
        }
    }

    pub fn set_state(&mut self, state: PoiProviderState) -> Result<(), PoiProviderError> {
        self.txid_indexer.set_state(state.txid_indexer);
        self.pending = state.pending;
        self.pois = state.pois;
        Ok(())
    }

    pub fn state(&self) -> PoiProviderState {
        PoiProviderState {
            txid_indexer: self.txid_indexer.state(),
            pending: self.pending.clone(),
            pois: self.pois.clone(),
        }
    }

    pub async fn sync(&mut self) -> Result<(), PoiProviderError> {
        self.sync_to(u64::MAX).await
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), PoiProviderError> {
        let poi_client = self.poi_client.clone();
        self.txid_indexer.sync_to(block_number, &poi_client).await?;
        self.submit_pending().await;
        Ok(())
    }

    pub async fn register_ops(&mut self, operations: &[ProvedOperation]) {
        let list_keys = self.poi_client.list_keys();
        for op in operations {
            self.register(op, list_keys.clone());
        }
    }

    /// Returns whether the given blinded commitment is spendable (i.e. has a
    /// valid POI proof) for all list keys in the POI client.
    pub async fn spendable(
        &mut self,
        blinded_commitment: BlindedCommitment,
    ) -> Result<bool, PoiProviderError> {
        for list_key in self.list_keys() {
            self.poi_proof(&list_key, blinded_commitment).await?;
        }
        Ok(true)
    }

    pub async fn poi_status(
        &mut self,
        list_key: &ListKey,
        blinded_commitment: BlindedCommitment,
        commitment_type: BlindedCommitmentType,
    ) -> Result<PoiStatus, PoiProviderError> {
        if let Some(list_key_map) = self.pois.get(&blinded_commitment) {
            if let Some(info) = list_key_map.get(list_key) {
                if let Some(status) = &info.status {
                    return Ok(status.clone());
                }
            }
        }

        let status = self
            .poi_client
            .poi_status(list_key, blinded_commitment, commitment_type)
            .await?;

        self.pois
            .entry(blinded_commitment)
            .or_default()
            .entry(list_key.clone())
            .or_default()
            .status = Some(status.clone());
        Ok(status)
    }

    pub async fn poi_proof(
        &mut self,
        list_key: &ListKey,
        blinded_commitment: BlindedCommitment,
    ) -> Result<MerkleProof, PoiProviderError> {
        if let Some(list_key_map) = self.pois.get(&blinded_commitment) {
            if let Some(info) = list_key_map.get(list_key) {
                if let Some(proof) = &info.proof {
                    return Ok(proof.clone());
                }
            }
        }

        let proof = self
            .poi_client
            .merkle_proof(list_key, blinded_commitment)
            .await?;

        self.pois
            .entry(blinded_commitment)
            .or_default()
            .entry(list_key.clone())
            .or_default()
            .proof = Some(proof.clone());
        Ok(proof)
    }

    pub fn list_keys(&self) -> Vec<ListKey> {
        self.poi_client.list_keys()
    }

    pub fn reset(&mut self) {
        self.txid_indexer.reset();
    }

    fn register(&mut self, op: &ProvedOperation, list_keys: Vec<ListKey>) {
        let spending_pubkey = op.inner.from.spending_key().public_key();
        let txid = Txid::from_operation(op);
        let in_notes = op.inner.in_notes().to_vec();
        let out_notes = op.inner.out_notes();
        let encryptable_notes = op.inner.out_encryptable_notes();

        info!(
            "Registered POI for {:?}",
            op.circuit_inputs.bound_params_hash
        );
        self.pending.push(PendingPoiEntry {
            txid,
            spending_pubkey,
            nullifying_key: op.inner.from.viewing_key().nullifying_key(),
            utxo_tree_in: op.inner.utxo_tree_number,
            bound_params_hash: op.circuit_inputs.bound_params_hash,
            in_notes,
            out_commitments: out_notes.iter().map(|n| n.hash().into()).collect(),
            out_npks: encryptable_notes
                .iter()
                .map(|n| n.note_public_key())
                .collect(),
            out_values: encryptable_notes
                .iter()
                .map(|n| U256::from(n.value()))
                .collect(),
            token_hash: op.inner.asset.hash(),
            has_unshield: op.inner.unshield_note().is_some(),
            list_keys,
        });
    }

    async fn submit_pending(&mut self) {
        for i in (0..self.pending.len()).rev() {
            let entry = self.pending[i].clone();
            match self.submit_poi(&entry).await {
                Ok(_) => {
                    info!("Submitted POI for {:?}", entry.txid);
                    self.pending.remove(i);
                }
                Err(e) => {
                    warn!(
                        "Failed to submit POI for pending entry {:?}: {:?}",
                        entry.txid, e
                    );
                }
            }
        }
    }

    async fn submit_poi(&self, entry: &PendingPoiEntry) -> Result<(), PendingPoiError> {
        let Some((txid_tree_number, _)) = self.txid_indexer.txid_position(&entry.txid) else {
            return Err(PendingPoiError::MissingTxidTree(entry.utxo_tree_in));
        };

        let Some((utxo_tree_number, utxo_leaf_index)) =
            self.txid_indexer.utxo_position(&entry.txid)
        else {
            return Err(PendingPoiError::MissingUtxoTree(entry.utxo_tree_in));
        };

        let txid_tree = self
            .txid_indexer
            .tree(txid_tree_number)
            .ok_or(PendingPoiError::MissingTxidTree(txid_tree_number))?;
        let utxo_tree_out = UtxoTreeIndex::included(utxo_tree_number, utxo_leaf_index);

        let mut proof_data = HashMap::new();
        for list_key in &entry.list_keys {
            let mut poi_notes = Vec::new();
            for note in entry.in_notes.clone() {
                let proof = self
                    .poi_client
                    .merkle_proof(list_key, note.blinded_commitment.into())
                    .await?;
                poi_notes.push(PoiNote::new(
                    note,
                    HashMap::from([(list_key.clone(), proof)]),
                ));
            }

            let inputs = PoiCircuitInputs::new(
                entry.spending_pubkey,
                entry.nullifying_key,
                entry.utxo_tree_in,
                entry.bound_params_hash,
                &poi_notes,
                &entry.out_commitments,
                &entry.out_npks,
                &entry.out_values,
                entry.token_hash,
                entry.has_unshield,
                list_key.clone(),
                utxo_tree_out,
                txid_tree,
            )?;

            let proof = prove_poi(self.prover.as_ref(), &inputs).await?;

            let mut blinded_commitments_out = Vec::new();
            for (i, (commitment, npk)) in entry
                .out_commitments
                .iter()
                .zip(entry.out_npks.iter())
                .enumerate()
            {
                let blinded_commitment = utxo::blinded_commitment(
                    commitment.clone(),
                    npk.clone(),
                    utxo_tree_number,
                    utxo_leaf_index + i as u32,
                )
                .into();
                blinded_commitments_out.push(blinded_commitment);
            }

            let txid_merkleroot_index =
                txid_tree_number as u64 * TOTAL_LEAVES as u64 + (txid_tree.leaves_len() as u64 - 1);

            proof_data.insert(
                list_key.clone(),
                TransactProofData {
                    proof,
                    poi_merkleroots: inputs.poi_merkleroots,
                    txid_merkleroot: inputs.railgun_txid_merkleroot_after_transaction,
                    txid_merkleroot_index,
                    blinded_commitments_out,
                    railgun_txid_if_has_unshield: inputs.railgun_txid_if_has_unshield,
                },
            );
        }

        self.poi_client.submit_proof(proof_data).await?;
        Ok(())
    }
}
