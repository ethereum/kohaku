//! Types for the POI client

use std::{collections::HashMap, fmt::Display, str::FromStr};

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    crypto::railgun_txid::Txid,
    railgun::{
        merkle_tree::{MerkleRoot, TxidLeafHash},
        note::utxo::UtxoType,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ListKey(String);

#[derive(Debug, Clone, PartialEq, Deserialize, Eq, Hash)]
pub struct BlindedCommitment(U256);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TxidVersion {
    #[serde(rename = "V2_PoseidonMerkle")]
    V2PoseidonMerkle,
    #[serde(rename = "V3_PoseidonMerkle")]
    V3PoseidonMerkle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BlindedCommitmentType {
    Shield,
    Transact,
    Unshield,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PoiEventType {
    Shield,
    Transact,
    Unshield,
    LegacyTransact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PoiStatus {
    Valid,
    ShieldBlocked,
    ProofSubmitted,
    Missing,
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
#[serde(rename_all = "camelCase")]
pub struct NodeStatusAllNetworks {
    pub list_keys: Vec<ListKey>,
    pub for_network: HashMap<String, NodeStatusForNetwork>,
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
pub struct RailgunTxidStatus {
    pub current_txid_index: u64,
    pub current_merkleroot: MerkleRoot,
    pub validated_txid_index: u64,
    pub validated_merkleroot: MerkleRoot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoiListStatus {
    pub poi_event_lengths: PoiEventLengths,
    pub list_provider_poi_event_queue_length: Option<u64>,
    pub pending_transact_proofs: u64,
    pub blocked_shields: u64,
    pub historical_merkleroots_length: u64,
    pub latest_historical_merkleroot: MerkleRoot,
}

pub type PoiEventLengths = HashMap<PoiEventType, u64>;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPoisPerListParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_keys: Vec<ListKey>,
    pub blinded_commitment_datas: Vec<BlindedCommitmentData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindedCommitmentData {
    #[serde(rename = "type")]
    pub commitment_type: BlindedCommitmentType,
    pub blinded_commitment: BlindedCommitment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMerkleProofsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: ListKey,
    pub blinded_commitments: Vec<BlindedCommitment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ValidatedRailgunTxidStatus {
    #[serde(rename = "validatedTxidIndex")]
    pub index: u64,
    #[serde(rename = "validatedMerkleroot")]
    pub merkleroot: MerkleRoot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateTxidMerklerootParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub tree: u32,
    pub index: u64,
    pub merkleroot: MerkleRoot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePoiMerklerootsParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: ListKey,
    pub poi_merkleroots: Vec<MerkleRoot>,
}

pub type PreTransactionPoisPerTxidLeafPerList =
    HashMap<ListKey, HashMap<TxidLeafHash, PreTransactionPoi>>;

pub type PoisPerListMap = HashMap<BlindedCommitment, HashMap<ListKey, PoiStatus>>;

/// POI proof for a single operation, proving that the input notes have valid POI.
#[derive(Debug, Clone, Serialize)]
pub struct PreTransactionPoi {
    #[serde(rename = "snarkProof")]
    pub proof: prover::Proof,
    #[serde(rename = "txidMerkleroot")]
    pub txid_merkleroot: MerkleRoot,
    #[serde(rename = "poiMerkleroots")]
    pub poi_merkleroots: Vec<MerkleRoot>,
    #[serde(rename = "blindedCommitmentsOut")]
    pub blinded_commitments_out: Vec<BlindedCommitment>,
    #[serde(rename = "railgunTxidIfHasUnshield")]
    pub railgun_txid_if_has_unshield: Txid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitTransactProofParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub list_key: ListKey,
    pub transact_proof_data: TransactProofData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactProofData {
    #[serde(rename = "snarkProof")]
    pub proof: prover::Proof,
    pub poi_merkleroots: Vec<MerkleRoot>,
    /// Merkle root of the txid tree the inclusion proof was generated with
    pub txid_merkleroot: MerkleRoot,
    /// Index of the txid tree the inclusion proof was generated with
    ///
    /// NOT the leaf index of the txid, but the index for the merkleroot of the
    /// txid tree. If a single railgun transaction had multiple txids, this
    /// would be the same for all of them since they're all being proven against
    /// the same snapshot of the txid tree.
    pub txid_merkleroot_index: u64,
    pub blinded_commitments_out: Vec<BlindedCommitment>,
    pub railgun_txid_if_has_unshield: Txid,
}

impl ValidatedRailgunTxidStatus {
    pub fn tree(&self) -> u32 {
        (self.index >> 16) as u32
    }

    pub fn leaf_index(&self) -> u64 {
        self.index & 0xFFFF
    }
}

impl Display for ListKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ListKey({})", self.0)
    }
}

impl Display for BlindedCommitment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "BlindedCommitment({:#x})", self.0)
    }
}

impl From<String> for ListKey {
    fn from(value: String) -> Self {
        ListKey(value)
    }
}

impl From<ListKey> for String {
    fn from(value: ListKey) -> Self {
        value.0
    }
}

impl From<&str> for ListKey {
    fn from(value: &str) -> Self {
        ListKey(value.to_string())
    }
}

impl From<U256> for BlindedCommitment {
    fn from(value: U256) -> Self {
        BlindedCommitment(value)
    }
}

impl From<BlindedCommitment> for U256 {
    fn from(value: BlindedCommitment) -> Self {
        value.0
    }
}

impl Serialize for BlindedCommitment {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let hex_string = format!("0x{:064x}", self.0);
        serializer.serialize_str(&hex_string)
    }
}

impl From<UtxoType> for BlindedCommitmentType {
    fn from(utxo_type: UtxoType) -> Self {
        match utxo_type {
            UtxoType::Shield => BlindedCommitmentType::Shield,
            UtxoType::Transact => BlindedCommitmentType::Transact,
        }
    }
}

impl Display for PoiStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            PoiStatus::Valid => "Valid",
            PoiStatus::ShieldBlocked => "ShieldBlocked",
            PoiStatus::ProofSubmitted => "ProofSubmitted",
            PoiStatus::Missing => "Missing",
        };
        write!(f, "{}", s)
    }
}

impl FromStr for PoiStatus {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "valid" => Ok(PoiStatus::Valid),
            "shieldblocked" => Ok(PoiStatus::ShieldBlocked),
            "proofsubmitted" => Ok(PoiStatus::ProofSubmitted),
            "missing" => Ok(PoiStatus::Missing),
            _ => Err(()),
        }
    }
}
