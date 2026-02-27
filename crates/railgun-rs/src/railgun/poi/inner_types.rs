//! Raw types for POI RPC requests and responses.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type ListKey = String;
/// Hex string
pub type BlindedCommitment = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TxidVersion {
    #[serde(rename = "V2_PoseidonMerkle")]
    V2PoseidonMerkle,
    #[serde(rename = "V3_PoseidonMerkle")]
    V3PoseidonMerkle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum NetworkName {
    #[serde(rename = "Ethereum")]
    Ethereum,
    #[serde(rename = "BNB_Chain")]
    BnbChain,
    #[serde(rename = "Polygon")]
    Polygon,
    #[serde(rename = "Arbitrum")]
    Arbitrum,
    #[serde(rename = "Ethereum_Sepolia")]
    EthereumSepolia,
    #[serde(rename = "Polygon_Amoy")]
    PolygonAmoy,
    #[serde(rename = "Hardhat")]
    Hardhat,
    #[serde(rename = "Ethereum_Ropsten")]
    EthereumRopstenDeprecated,
    #[serde(rename = "Ethereum_Goerli")]
    EthereumGoerliDeprecated,
    #[serde(rename = "Arbitrum_Goerli")]
    ArbitrumGoerliDeprecated,
    #[serde(rename = "Polygon_Mumbai")]
    PolygonMumbaiDeprecated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PoiEventType {
    Shield,
    Transact,
    Unshield,
    LegacyTransact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BlindedCommitmentType {
    Shield,
    Transact,
    Unshield,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PoiStatus {
    Valid,
    ShieldBlocked,
    ProofSubmitted,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PoiListType {
    Active,
    Gather,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainParams {
    pub chain_type: String,
    #[serde(rename = "chainID")]
    pub chain_id: String,
    pub txid_version: TxidVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnarkProof {
    pub pi_a: (String, String),
    pub pi_b: ((String, String), (String, String)),
    pub pi_c: (String, String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactProofData {
    pub snark_proof: SnarkProof,
    pub poi_merkleroots: Vec<String>,
    pub txid_merkleroot: String,
    pub txid_merkleroot_index: u64,
    pub blinded_commitments_out: Vec<String>,
    pub railgun_txid_if_has_unshield: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MerkleProof {
    pub leaf: String,
    pub elements: Vec<String>,
    pub indices: String,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTransactProofData {
    pub txid_index: String,
    pub npk: String,
    pub value: String,
    pub token_hash: String,
    pub blinded_commitment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreTransactionPoi {
    pub snark_proof: SnarkProof,
    pub txid_merkleroot: String,
    pub poi_merkleroots: Vec<String>,
    pub blinded_commitments_out: Vec<String>,
    pub railgun_txid_if_has_unshield: String,
}

/// `Record<listKey, Record<txidLeafHash, PreTransactionPOI>>`
pub type PreTransactionPoisPerTxidLeafPerList =
    HashMap<ListKey, HashMap<String, PreTransactionPoi>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleCommitmentProofsData {
    pub commitment: String,
    pub npk: String,
    pub utxo_tree_in: u64,
    pub utxo_tree_out: u64,
    pub utxo_position_out: u64,
    pub railgun_txid: String,
    pub pois: PreTransactionPoisPerTxidLeafPerList,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindedCommitmentData {
    pub blinded_commitment: BlindedCommitment,
    #[serde(rename = "type")]
    pub commitment_type: BlindedCommitmentType,
}

// ---------------------------------------------------------------------------
// Shield queue & node status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShieldQueueStatus {
    pub unknown: u64,
    pub pending: u64,
    pub allowed: u64,
    pub blocked: u64,
    #[serde(rename = "addedPOI")]
    pub added_poi: u64,
    pub latest_shield: Option<String>,
}

pub type PoiEventLengths = HashMap<PoiEventType, u64>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiListStatus {
    pub poi_event_lengths: PoiEventLengths,
    pub list_provider_poi_event_queue_length: Option<u64>,
    pub pending_transact_proofs: u64,
    pub blocked_shields: u64,
    pub historical_merkleroots_length: u64,
    pub latest_historical_merkleroot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RailgunTxidStatus {
    pub current_txid_index: Option<u64>,
    pub current_merkleroot: Option<String>,
    pub validated_txid_index: Option<u64>,
    pub validated_merkleroot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedRailgunTxidStatus {
    pub validated_txid_index: Option<u64>,
    /// Hex string without 0x prefix
    pub validated_merkleroot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatusForNetwork {
    pub txid_status: RailgunTxidStatus,
    pub shield_queue_status: ShieldQueueStatus,
    pub list_statuses: HashMap<String, PoiListStatus>,
    pub legacy_transact_proofs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatusAllNetworks {
    pub list_keys: Vec<ListKey>,
    pub for_network: HashMap<String, NodeStatusForNetwork>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiList {
    pub key: String,
    #[serde(rename = "type")]
    pub list_type: PoiListType,
    pub name: String,
    pub description: String,
}

// ---------------------------------------------------------------------------
// RPC request param structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTransactProofsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBlockedShieldsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_index: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitTransactProofParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
    pub transact_proof_data: TransactProofData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitLegacyTransactProofParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_keys: Vec<String>,
    pub legacy_transact_proof_datas: Vec<LegacyTransactProofData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitSingleCommitmentProofsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub single_commitment_proofs_data: SingleCommitmentProofsData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePoiMerklerootsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
    pub poi_merkleroots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPoisPerListParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_keys: Vec<String>,
    pub blinded_commitment_datas: Vec<BlindedCommitmentData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMerkleProofsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
    pub blinded_commitments: Vec<BlindedCommitment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateTxidMerklerootParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub tree: u64,
    pub index: u64,
    /// Hex string without 0x prefix
    pub merkleroot: String,
}

// -- POI events query (shape inferred from method name) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiEventsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_index: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiMerkletreeLeavesParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_index: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_index: Option<u64>,
}

pub type PoisPerListMap = HashMap<BlindedCommitment, HashMap<ListKey, PoiStatus>>;
