use alloy_primitives::{Address, Bytes, FixedBytes};
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use crate::{
    caip::AssetId,
    crypto::aes::Ciphertext,
    railgun::indexer::syncer::{self, normalize_tree_position::normalize_tree_position},
};

#[derive(Serialize)]
pub struct GraphqlRequest<V: Serialize> {
    pub query: &'static str,
    pub variables: V,
}

#[derive(Deserialize)]
pub struct GraphqlResponse<T> {
    pub data: Option<T>,
    pub errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
pub struct GraphQlError {
    pub message: String,
}

/// Shared query vars for commitment, nullifier, and operation queries.
#[derive(Serialize)]
pub struct QueryVars {
    pub id_gt: String,
    #[serde(rename = "blockNumber_gte")]
    pub block_number_gte: u64,
    #[serde(rename = "blockNumber_lte")]
    pub block_number_lte: u64,
    pub limit: u64,
}

#[derive(Deserialize)]
pub struct CommitmentsResponse {
    pub commitments: Vec<Commitment>,
}

#[derive(Deserialize)]
pub struct Commitment {
    pub id: String,
    #[serde(rename = "blockNumber", deserialize_with = "deserialize_string_to_u64")]
    pub block_number: u64,
    #[serde(deserialize_with = "deserialize_decimal_string_to_u256")]
    pub hash: U256,
    #[serde(rename = "treeNumber")]
    pub tree_number: u32,
    #[serde(rename = "treePosition")]
    pub tree_position: u32,
    #[serde(flatten)]
    pub kind: CommitmentKind,
}

#[derive(Deserialize)]
#[serde(tag = "__typename")]
pub enum CommitmentKind {
    ShieldCommitment {
        preimage: ShieldPreimage,
        #[serde(rename = "shieldKey")]
        shield_key: FixedBytes<32>,
        #[serde(rename = "encryptedBundle")]
        encrypted_bundle: Vec<FixedBytes<32>>,
    },
    TransactCommitment {
        ciphertext: TransactCiphertextOuter,
    },
    #[serde(other)]
    Legacy,
}

#[derive(Deserialize)]
pub struct ShieldPreimage {
    pub npk: FixedBytes<32>,
    #[serde(deserialize_with = "deserialize_decimal_string_to_u256")]
    pub value: U256,
    pub token: TokenInfo,
}

#[derive(Deserialize)]
pub struct TokenInfo {
    #[serde(rename = "tokenAddress")]
    pub token_address: Address,
    #[serde(rename = "tokenSubID")]
    pub token_sub_id: U256,
    #[serde(rename = "tokenType")]
    pub token_type: TokenType,
}

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TokenType {
    Erc20,
    Erc721,
    Erc1155,
}

#[derive(Deserialize)]
pub struct TransactCiphertextOuter {
    pub ciphertext: TransactCiphertextInner,
    pub memo: Bytes,
    #[serde(rename = "blindedSenderViewingKey")]
    pub blinded_sender_viewing_key: FixedBytes<32>,
    #[serde(rename = "blindedReceiverViewingKey")]
    pub blinded_receiver_viewing_key: FixedBytes<32>,
    #[serde(rename = "annotationData")]
    pub annotation_data: Bytes,
}

#[derive(Deserialize)]
pub struct TransactCiphertextInner {
    pub iv: FixedBytes<16>,
    pub tag: FixedBytes<16>,
    pub data: Vec<FixedBytes<32>>,
}

#[derive(Deserialize)]
pub struct NullifiersResponse {
    pub nullifiers: Vec<Nullified>,
}

#[derive(Deserialize)]
pub struct Nullified {
    pub id: String,
    pub nullifier: U256,
    #[serde(rename = "treeNumber")]
    pub tree_number: u32,
    #[serde(rename = "blockNumber", deserialize_with = "deserialize_string_to_u64")]
    pub block_number: u64,
}

#[cfg(feature = "poi")]
#[derive(Deserialize)]
pub struct OperationsResponse {
    #[serde(rename = "transactions")]
    pub operations: Vec<Operation>,
}

#[cfg(feature = "poi")]
#[derive(Deserialize)]
pub struct Operation {
    pub id: String,
    #[serde(rename = "blockNumber", deserialize_with = "deserialize_string_to_u64")]
    pub block_number: u64,
    pub nullifiers: Vec<U256>,
    pub commitments: Vec<U256>,
    #[serde(rename = "boundParamsHash")]
    pub bound_params_hash: U256,
    #[serde(rename = "utxoTreeIn", deserialize_with = "deserialize_string_to_u32")]
    pub utxo_tree_in: u32,
    #[serde(rename = "utxoTreeOut", deserialize_with = "deserialize_string_to_u32")]
    pub utxo_tree_out: u32,
    #[serde(
        rename = "utxoBatchStartPositionOut",
        deserialize_with = "deserialize_string_to_u32"
    )]
    pub utxo_batch_start_position_out: u32,
}

#[derive(Deserialize)]
pub struct BlockNumberResponsese {
    pub transactions: Vec<Transaction>,
}

#[derive(Debug, Deserialize)]
pub struct Transaction {
    #[serde(rename = "blockNumber", deserialize_with = "deserialize_string_to_u64")]
    pub block_number: u64,
}

#[allow(dead_code)]
fn deserialize_string_to_u32<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let s = String::deserialize(d)?;
    let r = s.parse().map_err(serde::de::Error::custom)?;
    Ok(r)
}

fn deserialize_string_to_u64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let s = String::deserialize(d)?;
    let r = s.parse().map_err(serde::de::Error::custom)?;
    Ok(r)
}

fn deserialize_decimal_string_to_u256<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<U256, D::Error> {
    let s = String::deserialize(d)?;
    U256::from_str_radix(&s, 10).map_err(serde::de::Error::custom)
}

impl From<Commitment> for syncer::SyncEvent {
    fn from(value: Commitment) -> Self {
        let (tree_number, leaf_index) =
            normalize_tree_position(value.tree_number, value.tree_position);

        match value.kind {
            CommitmentKind::Legacy => syncer::SyncEvent::Legacy(
                syncer::LegacyCommitment {
                    hash: value.hash.into(),
                    tree_number,
                    leaf_index,
                },
                value.block_number,
            ),
            CommitmentKind::ShieldCommitment {
                preimage,
                shield_key,
                encrypted_bundle,
            } => syncer::SyncEvent::Shield(
                syncer::Shield {
                    tree_number,
                    leaf_index,
                    npk: preimage.npk.into(),
                    token: preimage.token.into(),
                    value: preimage.value,
                    ciphertext: Ciphertext {
                        iv: encrypted_bundle[0][..16].try_into().unwrap(),
                        tag: encrypted_bundle[0][16..].try_into().unwrap(),
                        data: vec![encrypted_bundle[1][..16].to_vec()],
                    },
                    shield_key: shield_key.into(),
                },
                value.block_number,
            ),
            CommitmentKind::TransactCommitment { ciphertext } => {
                let mut data: Vec<Vec<u8>> = ciphertext
                    .ciphertext
                    .data
                    .iter()
                    .map(|chunk| chunk.to_vec())
                    .collect();
                data.push(ciphertext.memo.to_vec());

                syncer::SyncEvent::Transact(
                    syncer::Transact {
                        tree_number,
                        leaf_index,
                        hash: value.hash,
                        ciphertext: Ciphertext {
                            iv: *ciphertext.ciphertext.iv,
                            tag: *ciphertext.ciphertext.tag,
                            data,
                        },
                        blinded_receiver_viewing_key: *ciphertext.blinded_receiver_viewing_key,
                        blinded_sender_viewing_key: *ciphertext.blinded_sender_viewing_key,
                        annotation_data: ciphertext.annotation_data.to_vec(),
                    },
                    value.block_number,
                )
            }
        }
    }
}

impl From<Nullified> for syncer::SyncEvent {
    fn from(value: Nullified) -> Self {
        syncer::SyncEvent::Nullified(
            syncer::Nullified {
                tree_number: value.tree_number,
                nullifier: value.nullifier.into(),
            },
            value.block_number,
        )
    }
}

#[cfg(feature = "poi")]
impl From<Operation> for syncer::Operation {
    fn from(value: Operation) -> Self {
        let (utxo_tree_out, utxo_out_start_index) =
            normalize_tree_position(value.utxo_tree_out, value.utxo_batch_start_position_out);

        syncer::Operation {
            block_number: value.block_number,
            nullifiers: value.nullifiers,
            commitment_hashes: value.commitments,
            bound_params_hash: value.bound_params_hash,
            utxo_tree_in: value.utxo_tree_in,
            utxo_tree_out,
            utxo_out_start_index,
        }
    }
}

impl From<TokenInfo> for AssetId {
    fn from(value: TokenInfo) -> Self {
        match value.token_type {
            TokenType::Erc20 => AssetId::Erc20(value.token_address),
            TokenType::Erc721 => AssetId::Erc721(value.token_address, value.token_sub_id),
            TokenType::Erc1155 => AssetId::Erc1155(value.token_address, value.token_sub_id),
        }
    }
}
