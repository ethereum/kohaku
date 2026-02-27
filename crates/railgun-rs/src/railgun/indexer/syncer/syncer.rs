use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

use super::compat::BoxedSyncStream;
use crate::abis::railgun::RailgunSmartWallet;

/// TODO: Consider making types for shield, transact, and nullified so we don't need to use the anvil
/// types if it's more convenient.
#[derive(Clone, Serialize, Deserialize)]
pub enum SyncEvent {
    Shield(RailgunSmartWallet::Shield, u64),
    Transact(RailgunSmartWallet::Transact, u64),
    Nullified(RailgunSmartWallet::Nullified, u64),
    Legacy(LegacyCommitment, u64),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
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

/// Trait for syncers that emit note-level blockchain events (Shield, Transact, Nullified).
#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait NoteSyncer: Send + Sync {
    async fn latest_block(&self) -> Result<u64, Box<dyn std::error::Error>>;
    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<BoxedSyncStream<'_>, Box<dyn std::error::Error>>;
}

/// Trait for syncers that fetch full operation data (nullifiers + commitments + tree positions).
/// Used to build the TXID tree for post-transaction POI submission.
#[cfg(feature = "poi")]
#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait TransactionSyncer: Send + Sync {
    async fn latest_block(&self) -> Result<u64, Box<dyn std::error::Error>>;
    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<(Operation, u64)>, Box<dyn std::error::Error>>;
}
