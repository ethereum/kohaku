use alloy_primitives::FixedBytes;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{caip::AssetId, crypto::aes::Ciphertext};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncEvent {
    Shield(Shield, u64),
    Transact(Transact, u64),
    Nullified(Nullified, u64),
    Legacy(LegacyCommitment, u64),
}

/// A single Shield commitment event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shield {
    pub tree_number: u32,
    pub leaf_index: u32,
    pub npk: U256,
    pub token: AssetId,
    pub value: U256,
    pub ciphertext: Ciphertext,
    pub shield_key: [u8; 32],
}

/// A single transact commitment event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transact {
    pub tree_number: u32,
    pub leaf_index: u32,
    pub hash: U256,
    pub ciphertext: Ciphertext,
    pub blinded_sender_viewing_key: [u8; 32],
    pub blinded_receiver_viewing_key: [u8; 32],
    pub annotation_data: Vec<u8>,
}

/// A single nullified event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nullified {
    pub tree_number: u32,
    pub nullifier: FixedBytes<32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
    pub block_number: u64,
    pub nullifiers: Vec<U256>,
    pub commitment_hashes: Vec<U256>,
    pub bound_params_hash: U256,
    pub utxo_tree_in: u32,
    pub utxo_tree_out: u32,
    pub utxo_out_start_index: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LegacyCommitment {
    pub hash: U256,
    pub tree_number: u32,
    pub leaf_index: u32,
}

#[derive(Debug, Error)]
pub enum SyncerError {
    #[error("Syncer error: {0}")]
    Syncer(#[from] Box<dyn std::error::Error>),
}

/// Syncers that emit note-level events (Shield, Transact, Nullified).
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait NoteSyncer: common::MaybeSend {
    async fn latest_block(&self) -> Result<u64, SyncerError>;
    async fn sync(&self, from_block: u64, to_block: u64) -> Result<Vec<SyncEvent>, SyncerError>;
}

/// Syncers that fetch full operation data (nullifiers + commitments + tree positions).
#[cfg(feature = "poi")]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait TransactionSyncer: common::MaybeSend {
    async fn latest_block(&self) -> Result<u64, SyncerError>;
    async fn sync(&self, from_block: u64, to_block: u64) -> Result<Vec<Operation>, SyncerError>;
}
