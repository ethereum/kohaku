use std::{collections::HashMap, sync::Arc};

use alloy_primitives::Address;
use eth_rpc::EthRpcClientError;
use prover::Prover;
use rand::Rng;
use thiserror::Error;
use tracing::info;

use crate::{
    caip::AssetId,
    chain_config::ChainConfig,
    circuit::inputs::PoiCircuitInputsError,
    railgun::{
        Signer,
        address::RailgunAddress,
        indexer::UtxoIndexer,
        merkle_tree::MerkleRoot,
        note::utxo::UtxoNote,
        poi::{ListKey, PoiClient, PoiClientError, PoiNote},
        transaction::{
            PoiProvedOperation, PoiProvedOperationError, PoiProvedTx, ProvedTx, TransactionBuilder,
            TransactionBuilderError,
        },
    },
};

/// Builder for constructing transactions with POI proofs. This builder extends
/// the basic TransactionBuilder with support for attaching POI proofs to transactions.
pub struct PoiTransactionBuilder {
    inner: TransactionBuilder,
}

#[derive(Debug, Error)]
pub enum PoiTransactionBuilderError {
    #[error("Poi Client error: {0}")]
    PoiClient(#[from] PoiClientError),
    #[error("Poi Circuit input error: {0}")]
    PoiCircuitInput(#[from] PoiCircuitInputsError),
    #[error("POI Proved Operation error: {0}")]
    PoiProvedOperation(#[from] PoiProvedOperationError),
    #[error("Invalid POI merkleroot for list key {0}: {1}")]
    InvalidPoiMerkleroot(ListKey, MerkleRoot),
    #[error("RPC Error: {0}")]
    Estimator(#[from] EthRpcClientError),
    #[error("Build error: {0}")]
    Build(#[from] TransactionBuilderError),
}

impl PoiTransactionBuilder {
    pub fn new() -> Self {
        Self {
            inner: TransactionBuilder::new(),
        }
    }

    /// See [TransactionBuilder::transfer]
    pub fn transfer(
        self,
        from: Arc<dyn Signer>,
        to: RailgunAddress,
        asset: AssetId,
        value: u128,
        memo: &str,
    ) -> Self {
        Self {
            inner: self.inner.transfer(from, to, asset, value, memo),
        }
    }

    /// See [TransactionBuilder::set_unshield]
    pub fn unshield(
        self,
        from: Arc<dyn Signer>,
        to: Address,
        asset: AssetId,
        value: u128,
    ) -> Result<Self, PoiTransactionBuilderError> {
        Ok(Self {
            inner: self.inner.unshield(from, to, asset, value)?,
        })
    }

    /// Builds and proves a transaction for railgun.
    ///
    /// The resulting transaction can be self-broadcasted and includes POI Proof
    /// data.
    pub async fn build_poi<R: Rng>(
        self,
        chain: ChainConfig,
        indexer: &UtxoIndexer,
        prover: &dyn Prover,
        poi_client: &PoiClient,
        rng: &mut R,
    ) -> Result<PoiProvedTx, PoiTransactionBuilderError> {
        info!("Building POI Transaction");
        let list_keys = poi_client.list_keys();
        let in_notes = indexer.all_unspent();
        let poi_in_notes = notes_to_poi_notes(poi_client, &list_keys, in_notes).await;
        let proved = self
            .inner
            .build_transaction(
                prover,
                chain.id,
                chain.railgun_smart_wallet,
                &poi_in_notes,
                &indexer.utxo_trees,
                rng,
            )
            .await?;

        info!("Attaching POI proofs");
        self.prove_poi(prover, proved, &list_keys).await
    }

    /// Attach POI proofs to a proved transaction.
    async fn prove_poi(
        &self,
        prover: &dyn Prover,
        proved: ProvedTx<PoiNote>,
        list_keys: &[ListKey],
    ) -> Result<PoiProvedTx, PoiTransactionBuilderError> {
        let mut poi_operations = Vec::new();
        for proved_op in proved.proved_operations {
            poi_operations.push(PoiProvedOperation {
                operation: proved_op.operation,
                circuit_inputs: proved_op.circuit_inputs,
                pois: HashMap::new(),
                txid_leaf_hash: None,
                txid: None,
            });
        }

        // Attach POI proofs to each operation
        for poi_op in poi_operations.iter_mut() {
            poi_op.add_pois(prover, list_keys).await?;
        }

        Ok(PoiProvedTx {
            tx_data: proved.tx_data,
            operations: poi_operations,
        })
    }
}

async fn notes_to_poi_notes(
    poi_client: &PoiClient,
    list_keys: &[ListKey],
    in_notes: Vec<UtxoNote>,
) -> Vec<PoiNote> {
    info!("Loading note POI data");
    let mut poi_in_notes = Vec::new();
    for note in in_notes {
        match poi_client.note_to_poi_note(note, &list_keys).await {
            Ok(poi_note) => poi_in_notes.push(poi_note),
            Err(e) => {
                info!("Failed to get POI note: {:?}", e);
                continue;
            }
        }
    }
    poi_in_notes
}
