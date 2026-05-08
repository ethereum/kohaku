use std::{collections::HashMap, sync::Arc};

use alloy::primitives::ChainId;
use prover::Prover;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::railgun::{
    indexer::{TransactionSyncer, TxidIndexer, TxidIndexerError, TxidIndexerState},
    merkle_tree::MerkleProof,
    poi::{
        BlindedCommitment, BlindedCommitmentType, ListKey, PoiStatus,
        client::{PoiClient, PoiClientError},
        submitter::{PendingPoiError, PoiSubmitter, PoiSubmitterState},
    },
    transaction::ProvedOperation,
};

pub struct PoiProvider {
    txid_indexer: TxidIndexer,
    poi_client: PoiClient,
    prover: Arc<dyn Prover>,
    pending_submitter: PoiSubmitter,
    pois: HashMap<BlindedCommitment, HashMap<ListKey, PoiInfo>>,
}

#[derive(Serialize, Deserialize)]
pub struct PoiProviderState {
    pub txid_indexer: TxidIndexerState,
    pub pending_submitter: PoiSubmitterState,
    pub pois: HashMap<BlindedCommitment, HashMap<ListKey, PoiInfo>>,
}

#[derive(Debug, Error)]
pub enum PoiProviderError {
    #[error("Txid indexer error: {0}")]
    TxidIndexer(#[from] TxidIndexerError),
    #[error("Pending POI error: {0}")]
    PendingPoi(#[from] PendingPoiError),
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

impl PoiProvider {
    pub fn new(
        chain_id: ChainId,
        poi_endpoint: impl Into<String>,
        list_keys: Vec<ListKey>,
        prover: Arc<dyn Prover>,
        txid_syncer: Arc<dyn TransactionSyncer>,
    ) -> Self {
        let poi_client = PoiClient::new(chain_id, poi_endpoint, list_keys);

        Self {
            txid_indexer: TxidIndexer::new(txid_syncer, poi_client.clone()),
            poi_client,
            prover,
            pending_submitter: PoiSubmitter::new(),
            pois: HashMap::new(),
        }
    }

    pub fn set_state(&mut self, state: PoiProviderState) -> Result<(), PoiProviderError> {
        self.txid_indexer.set_state(state.txid_indexer);
        self.pending_submitter.set_state(state.pending_submitter);
        self.pois = state.pois;
        Ok(())
    }

    pub fn state(&self) -> PoiProviderState {
        PoiProviderState {
            txid_indexer: self.txid_indexer.state(),
            pending_submitter: self.pending_submitter.state(),
            pois: self.pois.clone(),
        }
    }

    pub async fn sync(&mut self) -> Result<(), PoiProviderError> {
        self.txid_indexer.sync().await?;
        self.pending_submitter
            .sync(&self.txid_indexer, &self.poi_client, self.prover.as_ref())
            .await;
        Ok(())
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), PoiProviderError> {
        self.txid_indexer.sync_to(block_number).await?;
        self.pending_submitter
            .sync(&self.txid_indexer, &self.poi_client, self.prover.as_ref())
            .await;
        Ok(())
    }

    pub async fn register_ops(&mut self, operations: &[ProvedOperation]) {
        let list_keys = self.poi_client.list_keys();
        self.pending_submitter.register_ops(operations, list_keys);
    }

    /// Returns whether the given blinded commitment is spendable (i.e. has a
    /// valid POI proof) for all list keys in the POI client.
    pub async fn spendable(
        &mut self,
        blinded_commitment: BlindedCommitment,
    ) -> Result<bool, PoiProviderError> {
        for list_key in self.list_keys() {
            //? Only returns OK() if the proof is valid
            self.poi_proof(&list_key, blinded_commitment).await?;
        }

        return Ok(true);
    }

    pub async fn poi_status(
        &mut self,
        list_key: &ListKey,
        blinded_commitment: BlindedCommitment,
        commitment_type: BlindedCommitmentType,
    ) -> Result<PoiStatus, PoiProviderError> {
        //? Check from cache
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

        //? Update cache
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
        //? Check from cache
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

        //? Update cache
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
}
