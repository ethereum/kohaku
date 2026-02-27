use std::{
    collections::{BTreeMap, HashMap},
    fmt::Display,
};

use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    abis,
    circuit::{
        inputs::{PoiCircuitInputs, PoiCircuitInputsError, TransactCircuitInputs},
        prover::PoiProver,
    },
    crypto::railgun_txid::Txid,
    railgun::{
        broadcaster::broadcaster::Fee,
        merkle_tree::{TxidLeafHash, UtxoMerkleTree},
        note::operation::Operation,
        poi::{BlindedCommitment, ListKey, PoiNote, PreTransactionPoi},
        transaction::tx_data::TxData,
    },
};

/// A transaction with POI proofs for all operations.
#[derive(Debug)]
pub struct PoiProvedTx {
    /// Transaction data to execute this transaction on-chain in railgun.
    pub tx_data: TxData,
    /// The operations with their POI proofs.
    pub operations: Vec<PoiProvedOperation>,
    pub min_gas_price: u128,
    /// Optional fee information if this transaction is being sent through a broadcaster.
    pub fee: Option<Fee>,
}

/// A proved operation with POI proofs attached for each list key.
#[derive(Debug)]
pub struct PoiProvedOperation {
    pub operation: Operation<PoiNote>,
    pub circuit_inputs: TransactCircuitInputs,
    pub transaction: abis::railgun::Transaction,
    /// POI proofs keyed by list key.
    pub pois: HashMap<ListKey, PreTransactionPoi>,
    /// The txid for this operation. Computed on first `add_pois` call.
    pub txid: Option<Txid>,
    /// The leaf hash for this operation. Computed on first `add_pois` call.
    pub txid_leaf_hash: Option<TxidLeafHash>,
}

#[derive(Debug, Error)]
pub enum PoiProvedOperationError {
    #[error("Missing UTXO tree for tree number {0}")]
    MissingTree(u32),
    #[error("Circuit Inputs error: {0}")]
    CircuitInputs(#[from] PoiCircuitInputsError),
    #[error("Prover error: {0}")]
    Prover(Box<dyn std::error::Error>),
}

impl PoiProvedOperation {
    /// Add POI proofs to this operation for the provided list keys.
    pub async fn add_pois(
        &mut self,
        prover: &dyn PoiProver,
        list_keys: &[ListKey],
        utxo_trees: &BTreeMap<u32, UtxoMerkleTree>,
    ) -> Result<(), PoiProvedOperationError> {
        let utxo_merkle_tree = utxo_trees.get(&self.operation.utxo_tree_number).ok_or(
            PoiProvedOperationError::MissingTree(self.operation.utxo_tree_number),
        )?;

        // Generate a POI proof for each list key and add it to the pois map.
        for list_key in list_keys {
            if self.pois.contains_key(list_key) {
                continue;
            }

            let out_commitments: Vec<_> = self
                .operation
                .out_notes()
                .iter()
                .map(|n| n.hash().into())
                .collect();
            let out_npks: Vec<_> = self
                .operation
                .out_encryptable_notes()
                .iter()
                .map(|n| n.note_public_key())
                .collect();
            let out_values: Vec<_> = self
                .operation
                .out_encryptable_notes()
                .iter()
                .map(|n| U256::from(n.value()))
                .collect();

            let inputs = PoiCircuitInputs::from_inputs(
                self.operation.from.spending_key().public_key(),
                self.operation.from.viewing_key().nullifying_key(),
                utxo_merkle_tree,
                self.operation.utxo_tree_number,
                self.circuit_inputs.bound_params_hash,
                &self.operation.in_notes,
                &out_commitments,
                &out_npks,
                &out_values,
                self.operation.asset.hash(),
                self.operation.unshield_note.is_some(),
                list_key.clone(),
            )?;

            // Store txid_leaf_hash and txid (same for all list keys)
            if self.txid_leaf_hash.is_none() {
                self.txid = Some(inputs.txid);
                self.txid_leaf_hash = Some(inputs.txid_leaf_hash);
            }

            let (proof, public_inputs) = prover
                .prove_poi(&inputs)
                .await
                .map_err(PoiProvedOperationError::Prover)?;

            let pre_transaction_poi = PreTransactionPoi {
                proof,
                txid_merkleroot: inputs.railgun_txid_merkleroot_after_transaction,
                poi_merkleroots: inputs.poi_merkleroots,
                blinded_commitments_out: public_inputs[0..inputs.commitments.len()]
                    .iter()
                    .copied()
                    .map(BlindedCommitment::from)
                    .collect(),
                railgun_txid_if_has_unshield: inputs.railgun_txid_if_has_unshield,
            };

            self.pois.insert(list_key.clone(), pre_transaction_poi);
        }

        Ok(())
    }
}

impl Display for PoiProvedOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "PoiProvedOperation({}, pois: {:?})",
            self.operation,
            self.pois.keys()
        )
    }
}
