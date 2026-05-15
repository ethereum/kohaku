//! Types for the POI client
//!
//! https://github.com/Railgun-Community/private-proof-of-innocence/blob/4b1eaf6ef19099dbfd6b43b1ca78d2ce0132a752/packages/node/src/api/README.md

use std::{collections::HashMap, fmt::Display, str::FromStr};

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use crate::{
    circuit::proof::Proof,
    crypto::railgun_txid::Txid,
    railgun::{merkle_tree::MerkleRoot, note::utxo::UtxoType},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi, type = "string"))]
pub struct ListKey(String);

#[derive(Debug, Copy, Clone, PartialEq, Deserialize, Eq, Hash)]
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
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
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
    pub index: u32,
    #[serde(rename = "validatedMerkleroot")]
    pub merkleroot: MerkleRoot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateTxidMerklerootParams {
    #[serde(flatten)]
    pub chain: ChainParams,
    pub tree: u32,
    pub index: u32,
    pub merkleroot: MerkleRoot,
}

pub type PoisPerListMap = HashMap<BlindedCommitment, HashMap<ListKey, PoiStatus>>;

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
    pub proof: Proof,
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

    pub fn leaf_index(&self) -> u32 {
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

impl FromStr for ListKey {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(ListKey(s.to_string()))
    }
}
