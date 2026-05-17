use std::{collections::HashMap, sync::Arc};

use alloy::primitives::ChainId;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

use crate::{
    circuit::{
        groth16_prover::Groth16Prover,
        inputs::poi_inputs::{PoiCircuitInputs, PoiCircuitInputsError},
    },
    crypto::{
        keys::{NullifyingKey, SpendingPublicKey},
        railgun_txid::Txid,
    },
    database::{Database, DatabaseError, RailgunDB},
    indexer::{
        syncer::TxidSyncer,
        txid_indexer::{TxidIndexer, TxidIndexerError},
    },
    merkle_tree::{MerkleProof, TOTAL_LEAVES, TxidMerkleTree, UtxoTreeIndex},
    note::utxo::{self, UtxoNote},
    poi::{
        client::{PoiClient, PoiClientError, PoiNodeClient},
        note::PoiNote,
        types::{BlindedCommitment, ListKey, PoiStatus, TransactProofData},
    },
    transact::proved_transaction::ProvedOperation,
};

pub struct PoiProvider {
    inner: PoiProviderState,
    db: Arc<dyn Database>,
    poi_client: PoiClient,
    txid_indexer: TxidIndexer,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct PoiProviderState {
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
    #[error("Database error: {0}")]
    Database(#[from] DatabaseError),
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
    Prover(Box<dyn std::error::Error + Send + Sync>),
    #[error("Missing UTXO tree {0}")]
    MissingUtxoTree(u32),
    #[error("Missing TXID tree {0}")]
    MissingTxidTree(u32),
}

impl PoiProvider {
    pub async fn new(
        chain_id: ChainId,
        db: Arc<dyn Database>,
        txid_syncer: Arc<dyn TxidSyncer>,
        poi_endpoint: impl Into<String>,
        list_keys: Vec<ListKey>,
    ) -> Result<Self, PoiProviderError> {
        let inner = db.get_poi_provider().await?;
        let txid_indexer = TxidIndexer::new(db.clone(), txid_syncer).await?;
        let poi_client = PoiClient::new(chain_id, poi_endpoint, list_keys);

        Ok(Self {
            inner,
            db,
            poi_client,
            txid_indexer,
        })
    }

    pub async fn sync_to(
        &mut self,
        prover: &Groth16Prover,
        to_block: u64,
    ) -> Result<(), PoiProviderError> {
        let poi_client = self.poi_client.clone();
        self.txid_indexer.sync_to(to_block, &poi_client).await?;
        self.submit_pending(prover).await;
        self.save().await?;
        Ok(())
    }

    pub async fn register_ops(&mut self, operations: &[ProvedOperation]) {
        let list_keys = self.poi_client.list_keys();
        for op in operations {
            self.register(op, list_keys.clone());
        }
    }

    pub fn list_keys(&self) -> Vec<ListKey> {
        self.poi_client.list_keys()
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

    pub async fn poi_proof(
        &mut self,
        list_key: &ListKey,
        blinded_commitment: BlindedCommitment,
    ) -> Result<MerkleProof, PoiProviderError> {
        if let Some(list_key_map) = self.inner.pois.get(&blinded_commitment) {
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

        self.inner
            .pois
            .entry(blinded_commitment)
            .or_default()
            .entry(list_key.clone())
            .or_default()
            .proof = Some(proof.clone());
        Ok(proof)
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
        self.inner.pending.push(PendingPoiEntry {
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

    async fn submit_pending(&mut self, prover: &Groth16Prover) {
        for i in (0..self.inner.pending.len()).rev() {
            let entry = self.inner.pending[i].clone();
            match self.submit_poi(prover, &entry).await {
                Ok(_) => {
                    info!("Submitted POI for {:?}", entry.txid);
                    self.inner.pending.remove(i);
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

    async fn submit_poi(
        &self,
        prover: &Groth16Prover,
        entry: &PendingPoiEntry,
    ) -> Result<(), PendingPoiError> {
        let txid_tree_number = match self.txid_indexer.txid_position(&entry.txid) {
            Some((tree_number, _)) => tree_number,
            None => return Err(PendingPoiError::MissingTxidTree(entry.utxo_tree_in)),
        };

        let (utxo_tree_number, utxo_leaf_index) = match self.txid_indexer.utxo_position(&entry.txid)
        {
            Some((tree_number, leaf_index)) => (tree_number, leaf_index),
            None => return Err(PendingPoiError::MissingUtxoTree(entry.utxo_tree_in)),
        };

        let txid_tree = match self.txid_indexer.tree(txid_tree_number) {
            Some(tree) => tree,
            None => return Err(PendingPoiError::MissingTxidTree(txid_tree_number)),
        };

        let utxo_tree_out = UtxoTreeIndex::included(utxo_tree_number, utxo_leaf_index);

        let proof_data = self
            .create_proof(
                prover,
                entry,
                txid_tree_number,
                utxo_tree_number,
                utxo_leaf_index,
                txid_tree,
                utxo_tree_out,
            )
            .await?;

        self.poi_client.submit_proof(proof_data).await?;
        Ok(())
    }

    async fn create_proof(
        &self,
        prover: &Groth16Prover,
        entry: &PendingPoiEntry,
        txid_tree_number: u32,
        utxo_tree_number: u32,
        utxo_leaf_index: u32,
        txid_tree: &TxidMerkleTree,
        utxo_tree_out: UtxoTreeIndex,
    ) -> Result<HashMap<ListKey, TransactProofData>, PendingPoiError> {
        let mut proof_data = HashMap::new();

        for list_key in &entry.list_keys {
            let mut in_notes = Vec::new();
            for note in entry.in_notes.clone() {
                let proof = self
                    .poi_client
                    .merkle_proof(list_key, note.blinded_commitment.into())
                    .await?;
                in_notes.push(PoiNote::new(
                    note,
                    HashMap::from([(list_key.clone(), proof)]),
                ));
            }

            let inputs = PoiCircuitInputs::from_inputs(
                entry.spending_pubkey,
                entry.nullifying_key,
                entry.utxo_tree_in,
                entry.bound_params_hash,
                &in_notes,
                &entry.out_commitments,
                &entry.out_npks,
                &entry.out_values,
                entry.token_hash,
                entry.has_unshield,
                list_key.clone(),
                utxo_tree_out,
                txid_tree,
            )?;

            let proof = prover
                .prove_poi(&inputs)
                .await
                .map_err(|e| PendingPoiError::Prover(Box::new(e)))?;
            let blinded_commitments_out =
                blinded_commitments(entry, utxo_tree_number, utxo_leaf_index);

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
        Ok(proof_data)
    }

    async fn save(&self) -> Result<(), PoiProviderError> {
        self.db.set_poi_provider(&self.inner).await?;
        Ok(())
    }
}

fn blinded_commitments(
    entry: &PendingPoiEntry,
    utxo_tree_number: u32,
    utxo_leaf_index: u32,
) -> Vec<BlindedCommitment> {
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
    blinded_commitments_out
}
