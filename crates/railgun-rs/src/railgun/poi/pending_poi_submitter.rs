use std::collections::HashMap;

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::info;

use crate::{
    circuit::{
        inputs::poi_inputs::{PoiCircuitInputs, PoiCircuitInputsError},
        prover::PoiProver,
    },
    crypto::{
        keys::{NullifyingKey, SpendingPublicKey},
        railgun_txid::Txid,
    },
    railgun::{
        indexer::{TxidIndexer, UtxoIndexer},
        merkle_tree::{TOTAL_LEAVES, UtxoTreeIndex},
        note::utxo::UtxoNote,
        poi::{BlindedCommitment, ListKey, PoiClient, PoiClientError, types::TransactProofData},
        transaction::PoiProvedOperation,
    },
};

/// Tracks operations that have been broadcast and are waiting for their on-chain
/// TXID position to become validated so that post-transaction POI proofs can be
/// submitted to the aggregator.
pub struct PendingPoiSubmitter {
    pending: Vec<PendingPoiEntry>,
}

#[derive(Serialize, Deserialize)]
pub struct PendingPoiSubmitterState {
    pending: Vec<PendingPoiEntry>,
}

/// Serializable snapshot needed to re-prove and submit a post-transaction POI
/// proof to the POI aggregator.
///
/// TODO: Consider privacy / security implications of storing this data on disk.
/// All the values are required, but many are sensitive.
#[derive(Clone, Serialize, Deserialize)]
pub struct PendingPoiEntry {
    /// Txid used to look up the on-chain position in the TXID tree.
    pub txid: Txid,
    pub spending_pubkey: SpendingPublicKey,
    pub nullifying_key: NullifyingKey,
    pub utxo_tree_in: u32,
    pub bound_params_hash: U256,
    /// Input UTXO notes. Fresh POI proofs are re-fetched at process time.
    pub in_notes: Vec<UtxoNote<()>>,
    /// Hashes of all output notes (fee + transfer + unshield, unpadded).
    pub out_commitments: Vec<U256>,
    /// Note public keys of encryptable (non-unshield) output notes.
    pub out_npks: Vec<U256>,
    /// Values of encryptable output notes.
    pub out_values: Vec<U256>,
    pub token: U256,
    pub has_unshield: bool,
    pub list_keys: Vec<ListKey>,
}

#[derive(Debug, Error)]
pub enum PendingPoiError {
    #[error("POI client error: {0}")]
    PoiClient(#[from] PoiClientError),
    #[error("Circuit inputs error: {0}")]
    CircuitInputs(#[from] PoiCircuitInputsError),
    #[error("Prover error: {0}")]
    Prover(Box<dyn std::error::Error>),
    #[error("Missing UTXO tree {0}")]
    MissingUtxoTree(u32),
    #[error("Missing TXID tree {0}")]
    MissingTxidTree(u32),
}

impl PendingPoiSubmitter {
    pub fn new() -> Self {
        PendingPoiSubmitter {
            pending: Vec::new(),
        }
    }

    pub fn set_state(&mut self, state: PendingPoiSubmitterState) {
        self.pending = state.pending;
    }

    pub fn state(&self) -> PendingPoiSubmitterState {
        PendingPoiSubmitterState {
            pending: self.pending.clone(),
        }
    }

    /// Register a proved operation for post-transaction POI submission.
    pub fn register(&mut self, op: &PoiProvedOperation) {
        let Some(txid) = op.txid else { return };
        let spending_pubkey = op.operation.from.spending_key().public_key();

        let in_notes = &op.operation.in_notes;
        let out_notes = op.operation.out_notes();
        let encryptable_notes = op.operation.out_encryptable_notes();

        info!("Registering pending POI submission for txid {:?}", txid,);
        self.pending.push(PendingPoiEntry {
            txid,
            spending_pubkey,
            nullifying_key: op.operation.from.viewing_key().nullifying_key(),
            utxo_tree_in: op.operation.utxo_tree_number,
            bound_params_hash: op.circuit_inputs.bound_params_hash,
            in_notes: in_notes
                .iter()
                .map(|n| n.inner().without_signer().clone())
                .collect(),
            out_commitments: out_notes.iter().map(|n| n.hash().into()).collect(),
            out_npks: encryptable_notes
                .iter()
                .map(|n| n.note_public_key())
                .collect(),
            out_values: encryptable_notes
                .iter()
                .map(|n| U256::from(n.value()))
                .collect(),
            token: op.operation.asset.hash(),
            has_unshield: op.operation.unshield_note.is_some(),
            list_keys: op.pois.keys().cloned().collect(),
        });
    }

    /// Process pending entries: for each entry whose txid now has a validated
    /// on-chain position, re-proves with the real TXID Merkle position and
    /// submits to the POI aggregator.
    ///
    /// Returns the txids that were successfully submitted.
    pub async fn process(
        &mut self,
        txid_indexer: &TxidIndexer,
        utxo_indexer: &UtxoIndexer,
        poi_client: &PoiClient,
        prover: &dyn PoiProver,
    ) -> Result<Vec<Txid>, PendingPoiError> {
        let mut submitted = Vec::new();
        for i in (0..self.pending.len()).rev() {
            let entry = &self.pending[i];

            let Some((txid_tree_number, _)) = txid_indexer.txid_position(&entry.txid) else {
                info!(
                    "Txid {:?} for note within bound params hash {:?} not yet found in TXID tree, skipping",
                    entry.txid, entry.bound_params_hash
                );
                continue;
            };

            let Some((utxo_tree_number, utxo_leaf_index)) = txid_indexer.utxo_position(&entry.txid)
            else {
                info!(
                    "Txid {:?} for note within bound params hash {:?} not yet found in UTXO tree, skipping",
                    entry.txid, entry.bound_params_hash
                );
                continue;
            };

            let txid_tree = txid_indexer
                .tree(txid_tree_number)
                .ok_or(PendingPoiError::MissingTxidTree(txid_tree_number))?;

            let utxo_tree = utxo_indexer
                .utxo_trees
                .get(&entry.utxo_tree_in)
                .ok_or(PendingPoiError::MissingUtxoTree(entry.utxo_tree_in))?;

            let included = UtxoTreeIndex::included(utxo_tree_number, utxo_leaf_index);

            // Re-fetch fresh POI merkle proofs from the aggregator.
            let mut poi_notes = Vec::new();
            for note in entry.in_notes.clone() {
                let poi_note = match poi_client.note_to_poi_note(note, &entry.list_keys).await {
                    Ok(poi_note) => poi_note,
                    Err(e) => {
                        info!("Failed to get POI note for txid {:?}: {:?}", entry.txid, e);
                        continue;
                    }
                };
                poi_notes.push(poi_note);
            }

            // Build and submit a proof for each list key.
            let mut proof_data_map = HashMap::new();
            for list_key in &entry.list_keys {
                let inputs = PoiCircuitInputs::from_inputs_included(
                    entry.spending_pubkey,
                    entry.nullifying_key,
                    utxo_tree,
                    entry.utxo_tree_in,
                    entry.bound_params_hash,
                    &poi_notes,
                    &entry.out_commitments,
                    &entry.out_npks,
                    &entry.out_values,
                    entry.token,
                    entry.has_unshield,
                    list_key.clone(),
                    included,
                    txid_tree,
                )?;

                let (proof, public_inputs) = prover
                    .prove_poi(&inputs)
                    .await
                    .map_err(PendingPoiError::Prover)?;

                let blinded_commitments_out = public_inputs[0..inputs.commitments.len()]
                    .iter()
                    .copied()
                    .map(BlindedCommitment::from)
                    .collect();
                let txid_merkleroot_index = txid_tree_number as u64 * TOTAL_LEAVES as u64
                    + (txid_tree.leaves_len() as u64 - 1);
                proof_data_map.insert(
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

            poi_client.submit_operation(proof_data_map).await?;
            let txid = entry.txid;
            self.pending.remove(i);
            info!("Submitted POI for {:?}", txid);
            submitted.push(txid);
        }

        Ok(submitted)
    }
}
