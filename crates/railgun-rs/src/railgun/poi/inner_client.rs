use reqwest::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::info;

use crate::railgun::{
    merkle_tree::merkle_proof::MerkleRoot,
    poi::{inner_types::*, poi_client::PoiMerkleProofError},
};

#[derive(Debug, Serialize)]
struct JsonRpcRequest<P: Serialize> {
    jsonrpc: &'static str,
    method: &'static str,
    id: u64,
    params: P,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<R> {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: u64,
    result: Option<R>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

impl std::fmt::Display for JsonRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RPC error {}: {}", self.code, self.message)
    }
}

impl std::error::Error for JsonRpcError {}

#[derive(Debug, thiserror::Error)]
pub enum PoiClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON-RPC error: {0}")]
    Rpc(JsonRpcError),
    #[error("Null result from RPC")]
    NullResult,
    #[error("Unexpected response: {0}")]
    UnexpectedResponse(String),
    #[error("Merkle proof error: {0}")]
    MerkleProof(#[from] PoiMerkleProofError),
    #[error("Invalid POI Merkle root for list key {0}: {1}")]
    InvalidPoiMerkleRoot(ListKey, MerkleRoot),
}

// TODO: Replace me with jsonrpsee or jsonrpc_client! macros. Would be much
// less boilerplate, and we're wraping the type with a stricter interface anyway.
pub struct InnerPoiClient {
    http: Client,
    url: String,
    next_id: AtomicU64,
}

impl InnerPoiClient {
    pub fn new(url: impl Into<String>) -> Self {
        #[cfg(not(feature = "wasm"))]
        let http = Client::builder()
            .http1_only()
            .pool_max_idle_per_host(0)
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("failed to build HTTP client");

        #[cfg(feature = "wasm")]
        let http = Client::new();

        Self {
            http,
            url: url.into(),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn with_client(http: Client, url: impl Into<String>) -> Self {
        Self {
            http,
            url: url.into(),
            next_id: AtomicU64::new(1),
        }
    }

    async fn call<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &'static str,
        params: P,
    ) -> Result<R, PoiClientError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            method,
            id,
            params,
        };

        info!("Calling RPC method: {}", method);
        info!("Request: {}", serde_json::to_string(&req).unwrap());

        let resp: JsonRpcResponse<R> = self
            .http
            .post(&self.url)
            .header("connection", "close")
            .json(&req)
            .send()
            .await?
            .json()
            .await?;

        if let Some(err) = resp.error {
            return Err(PoiClientError::Rpc(err));
        }
        resp.result.ok_or(PoiClientError::NullResult)
    }

    async fn call_no_params<R: DeserializeOwned>(
        &self,
        method: &'static str,
    ) -> Result<R, PoiClientError> {
        self.call::<serde_json::Value, R>(method, serde_json::json!({}))
            .await
    }

    // -- Health & status ---------------------------------------------------

    /// `ppoi_health`
    pub async fn health(&self) -> Result<String, PoiClientError> {
        self.call::<Vec<()>, _>("ppoi_health", vec![]).await
    }

    /// `ppoi_node_status` — full status across all networks
    pub async fn node_status(&self) -> Result<NodeStatusAllNetworks, PoiClientError> {
        self.call_no_params("ppoi_node_status").await
    }

    /// `ppoi_node_status_forwardedList`
    pub async fn node_status_forwarded_list(
        &self,
    ) -> Result<NodeStatusAllNetworks, PoiClientError> {
        self.call_no_params("ppoi_node_status_forwardedList").await
    }

    // -- POI events & merkletree ------------------------------------------

    /// `ppoi_poi_events`
    pub async fn poi_events(
        &self,
        params: PoiEventsParams,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_poi_events", params).await
    }

    /// `ppoi_poi_merkletree_leaves`
    pub async fn poi_merkletree_leaves(
        &self,
        params: PoiMerkletreeLeavesParams,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_poi_merkletree_leaves", params).await
    }

    // -- Transact proofs --------------------------------------------------

    /// `ppoi_transact_proofs`
    pub async fn transact_proofs(
        &self,
        params: GetTransactProofsParams,
    ) -> Result<Vec<TransactProofData>, PoiClientError> {
        self.call("ppoi_transact_proofs", params).await
    }

    /// `ppoi_legacy_transact_proofs`
    pub async fn legacy_transact_proofs(
        &self,
        params: ChainParams,
    ) -> Result<Vec<LegacyTransactProofData>, PoiClientError> {
        self.call("ppoi_legacy_transact_proofs", params).await
    }

    // -- Blocked shields --------------------------------------------------

    /// `ppoi_blocked_shields`
    pub async fn blocked_shields(
        &self,
        params: GetBlockedShieldsParams,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_blocked_shields", params).await
    }

    // -- Submit operations ------------------------------------------------

    /// `ppoi_submit_poi_events`
    pub async fn submit_poi_events(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_submit_poi_events", params).await
    }

    /// `ppoi_submit_validated_txid`
    pub async fn submit_validated_txid(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_submit_validated_txid", params).await
    }

    /// `ppoi_remove_transact_proof`
    pub async fn remove_transact_proof(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_remove_transact_proof", params).await
    }

    /// `ppoi_submit_transact_proof`
    pub async fn submit_transact_proof(
        &self,
        params: SubmitTransactProofParams,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_submit_transact_proof", params).await
    }

    /// `ppoi_submit_legacy_transact_proofs`
    pub async fn submit_legacy_transact_proofs(
        &self,
        params: SubmitLegacyTransactProofParams,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_submit_legacy_transact_proofs", params)
            .await
    }

    /// `ppoi_submit_single_commitment_proofs`
    pub async fn submit_single_commitment_proofs(
        &self,
        params: SubmitSingleCommitmentProofsParams,
    ) -> Result<serde_json::Value, PoiClientError> {
        self.call("ppoi_submit_single_commitment_proofs", params)
            .await
    }

    // -- Query operations -------------------------------------------------

    /// `ppoi_pois_per_list`
    pub async fn pois_per_list(
        &self,
        params: GetPoisPerListParams,
    ) -> Result<PoisPerListMap, PoiClientError> {
        self.call("ppoi_pois_per_list", params).await
    }

    /// `ppoi_pois_per_blinded_commitment`
    pub async fn pois_per_blinded_commitment(
        &self,
        params: GetPoisPerListParams,
    ) -> Result<PoisPerListMap, PoiClientError> {
        self.call("ppoi_pois_per_blinded_commitment", params).await
    }

    /// `ppoi_merkle_proofs`
    pub async fn merkle_proofs(
        &self,
        params: GetMerkleProofsParams,
    ) -> Result<Vec<MerkleProof>, PoiClientError> {
        self.call("ppoi_merkle_proofs", params).await
    }

    // -- Validation -------------------------------------------------------

    /// `ppoi_validated_txid`
    pub async fn validated_txid(
        &self,
        params: ChainParams,
    ) -> Result<ValidatedRailgunTxidStatus, PoiClientError> {
        self.call("ppoi_validated_txid", params).await
    }

    /// `ppoi_validate_txid_merkleroot`
    pub async fn validate_txid_merkleroot(
        &self,
        params: ValidateTxidMerklerootParams,
    ) -> Result<bool, PoiClientError> {
        self.call("ppoi_validate_txid_merkleroot", params).await
    }

    /// `ppoi_validate_poi_merkleroots`
    pub async fn validate_poi_merkleroots(
        &self,
        params: ValidatePoiMerklerootsParams,
    ) -> Result<bool, PoiClientError> {
        self.call("ppoi_validate_poi_merkleroots", params).await
    }
}
