use std::collections::HashMap;

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
        indexer::TxidIndexer,
        merkle_tree::{TOTAL_LEAVES, UtxoTreeIndex},
        note::utxo::UtxoNote,
        poi::{
            BlindedCommitment, ListKey, PoiNote,
            client::{PoiClient, PoiClientError},
            types::TransactProofData,
        },
        transaction::ProvedOperation,
    },
};

/// Tracks operations that have been broadcast and are waiting for their on-chain
/// TXID position to become validated so that post-transaction POI proofs can be
/// submitted to the aggregator.
pub struct PoiSubmitter {
    pending: Vec<PendingPoiEntry>,
}

#[derive(Serialize, Deserialize)]
pub struct PoiSubmitterState {
    pending: Vec<PendingPoiEntry>,
}

/// Serializable snapshot needed to re-prove and submit a post-transaction POI
/// proof to the POI aggregator.
///
/// TODO: Consider privacy / security implications of storing this data on disk.
/// All the values are required, but many are sensitive.
#[derive(Clone, Serialize, Deserialize)]
pub struct PendingPoiEntry {
    pub txid: Txid,
    /// Txid used to look up the on-chain position in the TXID tree.
    pub spending_pubkey: SpendingPublicKey,
    pub nullifying_key: NullifyingKey,
    pub utxo_tree_in: u32,
    pub bound_params_hash: U256,
    /// Input UTXO notes. Fresh POI proofs are re-fetched at process time.
    pub in_notes: Vec<UtxoNote>,
    /// Hashes of all output notes.
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
    Prover(#[from] ProverError),
    #[error("Missing UTXO tree {0}")]
    MissingUtxoTree(u32),
    #[error("Missing TXID tree {0}")]
    MissingTxidTree(u32),
}

impl PoiSubmitter {
    pub fn new() -> Self {
        PoiSubmitter {
            pending: Vec::new(),
        }
    }

    pub fn set_state(&mut self, state: PoiSubmitterState) {
        self.pending = state.pending;
    }

    pub fn state(&self) -> PoiSubmitterState {
        PoiSubmitterState {
            pending: self.pending.clone(),
        }
    }

    pub fn register_ops(&mut self, operations: &[ProvedOperation], list_keys: Vec<ListKey>) {
        for op in operations {
            self.register(op, list_keys.clone());
        }
    }

    /// Register a proved operation for post-transaction POI submission.
    pub fn register(&mut self, op: &ProvedOperation, list_keys: Vec<ListKey>) {
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
            token: op.inner.asset.hash(),
            has_unshield: op.inner.unshield_note().is_some(),
            list_keys,
        });
    }

    /// Tries to submit pending entries: for each entry whose txid now has a validated
    /// on-chain position, re-proves with the real TXID Merkle position and
    /// submits to the POI aggregator.
    pub async fn sync(
        &mut self,
        txid_indexer: &TxidIndexer,
        poi_client: &PoiClient,
        prover: &dyn Prover,
    ) {
        for i in (0..self.pending.len()).rev() {
            match self.submit_poi(txid_indexer, poi_client, prover, i).await {
                Ok(_) => {
                    let entry = &self.pending[i];
                    info!("Submitted POI for {:?}", entry.txid);
                    self.pending.remove(i);
                }
                Err(e) => {
                    warn!(
                        "Failed to submit POI for pending entry at index {}: {:?}",
                        i, e
                    );
                    continue;
                }
            }
        }
    }

    async fn submit_poi(
        &mut self,
        txid_indexer: &TxidIndexer,
        poi_client: &PoiClient,
        prover: &dyn Prover,
        i: usize,
    ) -> Result<(), PendingPoiError> {
        let entry = &self.pending[i];
        let Some((txid_tree_number, _)) = txid_indexer.txid_position(&entry.txid) else {
            return Err(PendingPoiError::MissingTxidTree(entry.utxo_tree_in));
        };

        let Some((utxo_tree_number, utxo_leaf_index)) = txid_indexer.utxo_position(&entry.txid)
        else {
            return Err(PendingPoiError::MissingUtxoTree(entry.utxo_tree_in));
        };

        let txid_tree = txid_indexer
            .tree(txid_tree_number)
            .ok_or(PendingPoiError::MissingTxidTree(txid_tree_number))?;
        let included = UtxoTreeIndex::included(utxo_tree_number, utxo_leaf_index);

        let mut proof_data = HashMap::new();
        for list_key in &entry.list_keys {
            // Re-fetch fresh POI merkle proofs from the aggregator.
            let mut poi_notes = Vec::new();
            for note in entry.in_notes.clone() {
                let proof = poi_client
                    .merkle_proof(list_key, note.blinded_commitment.into())
                    .await?;

                let pois = HashMap::from([(list_key.clone(), proof)]);
                poi_notes.push(PoiNote::new(note, pois));
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
                entry.token,
                entry.has_unshield,
                list_key.clone(),
                included,
                txid_tree,
            )?;

            let (proof, public_inputs) = prove_poi(prover, &inputs).await?;
            let blinded_commitments_out = public_inputs[0..inputs.commitments.len()]
                .iter()
                .copied()
                .map(BlindedCommitment::from)
                .collect();

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

        poi_client.submit_proof(proof_data).await?;
        Ok(())
    }
}
