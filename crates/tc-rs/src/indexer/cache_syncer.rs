use alloy::primitives::{Address, FixedBytes, TxHash, map::HashMap};
use serde::Deserialize;
use thiserror::Error;
use tracing::info;

use crate::indexer::syncer::{Commitment, Nullifier, Syncer, SyncerError};

/// A syncer that reads from a pre-generated cache of commitments and nullifiers
pub struct CacheSyncer {
    cache: Cache,
    latest_block: u64,
}

#[derive(Debug, Error)]
pub enum CacheSyncerError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize)]
struct Cache {
    contracts: HashMap<Address, ContractCache>,
}

#[derive(Deserialize)]
struct ContractCache {
    pub deposits: Vec<RawDeposit>,
    pub withdrawals: Vec<RawWithdrawal>,
}

#[derive(Deserialize)]
struct RawDeposit {
    #[serde(rename = "blockNumber")]
    block_number: u64,
    #[serde(rename = "transactionHash")]
    transaction_hash: TxHash,
    commitment: FixedBytes<32>,
    #[serde(rename = "leafIndex")]
    leaf_index: u32,
}

#[derive(Deserialize)]
struct RawWithdrawal {
    #[serde(rename = "blockNumber")]
    block_number: u64,
    #[serde(rename = "transactionHash")]
    transaction_hash: TxHash,
    #[serde(rename = "nullifierHash")]
    nullifier_hash: FixedBytes<32>,
    to: Address,
    fee: String,
}

impl CacheSyncer {
    pub fn from_str(cache: &str) -> Result<Self, CacheSyncerError> {
        let cache: Cache = serde_json::from_str(cache)?;

        let mut latest_block = 0u64;
        for (_, contract) in &cache.contracts {
            for deposit in &contract.deposits {
                latest_block = latest_block.max(deposit.block_number);
            }
            for withdrawal in &contract.withdrawals {
                latest_block = latest_block.max(withdrawal.block_number);
            }
        }

        Ok(Self {
            cache,
            latest_block,
        })
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl Syncer for CacheSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        Ok(self.latest_block)
    }

    async fn sync_commitments(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Commitment>, SyncerError> {
        info!(
            "CacheSyncer syncing commitments from block {} to {}",
            from_block, to_block
        );

        let cache = self
            .cache
            .contracts
            .get(&contract)
            .ok_or(SyncerError::InvalidContract {
                contract: contract,
                reason: "Missing cache".to_string(),
            })?;

        let commitments: Vec<Commitment> = cache.deposits.iter().map(|c| c.into()).collect();
        let commitments = commitments
            .into_iter()
            .filter(|c| c.block_number >= from_block && c.block_number <= to_block)
            .collect();
        Ok(commitments)
    }

    async fn sync_nullifiers(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Nullifier>, SyncerError> {
        info!(
            "CacheSyncer syncing nullifiers from block {} to {}",
            from_block, to_block
        );

        let cache = self
            .cache
            .contracts
            .get(&contract)
            .ok_or(SyncerError::InvalidContract {
                contract: contract,
                reason: "Missing cache".to_string(),
            })?;

        let nullifiers: Vec<Nullifier> = cache.withdrawals.iter().map(|w| w.into()).collect();
        let nullifiers = nullifiers
            .into_iter()
            .filter(|n| n.block_number >= from_block && n.block_number <= to_block)
            .collect();
        Ok(nullifiers)
    }
}

impl From<&RawDeposit> for Commitment {
    fn from(raw: &RawDeposit) -> Self {
        Commitment {
            block_number: raw.block_number,
            tx_hash: raw.transaction_hash,
            commitment: raw.commitment,
            leaf_index: raw.leaf_index,
            timestamp: 0, // No timestamp in cache
        }
    }
}

impl From<&RawWithdrawal> for Nullifier {
    fn from(raw: &RawWithdrawal) -> Self {
        Nullifier {
            block_number: raw.block_number,
            tx_hash: raw.transaction_hash,
            nullifier: raw.nullifier_hash,
            to: raw.to,
            fee: raw.fee.parse().unwrap_or(0), // Parse fee from string, default to 0 on error
            timestamp: 0,                      // No timestamp in cache
        }
    }
}
