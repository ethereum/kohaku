use alloy::{
    primitives::{Address, FixedBytes, TxHash},
    rpc::types::Log,
};
use alloy_sol_types::SolEvent;
use thiserror::Error;

use crate::abis::tornado::Tornado;

#[derive(Debug, Error)]
pub enum SyncerError {
    #[error("Syncer error: {0}")]
    Syncer(#[from] Box<dyn std::error::Error>),
    #[error("Invalid contract {contract}: {reason}")]
    InvalidContract { contract: Address, reason: String },
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait Syncer: Send + Sync {
    async fn latest_block(&self) -> Result<u64, SyncerError>;

    async fn sync_commitments(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Commitment>, SyncerError>;

    async fn sync_nullifiers(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Nullifier>, SyncerError>;
}

#[derive(Debug, Clone)]
pub struct Commitment {
    pub block_number: u64,
    pub tx_hash: TxHash,
    pub commitment: FixedBytes<32>,
    pub leaf_index: u32,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct Nullifier {
    pub block_number: u64,
    pub tx_hash: TxHash,
    pub nullifier: FixedBytes<32>,
    pub to: Address,
    pub fee: u128,
    pub timestamp: u64,
}

impl TryFrom<Log> for Commitment {
    type Error = String;

    fn try_from(log: Log) -> Result<Self, Self::Error> {
        if log.topics().first().copied() != Some(Tornado::Deposit::SIGNATURE_HASH) {
            return Err(format!(
                "Invalid event signature: expected {}, got {}",
                Tornado::Deposit::SIGNATURE_HASH,
                log.topics().first().copied().unwrap_or_default()
            ));
        }

        let block_number = log.block_number.unwrap_or(0);
        let tx_hash = log.transaction_hash.unwrap_or_default();
        let event = Tornado::Deposit::decode_log(&log.inner)
            .map_err(|e| format!("Failed to decode log: {}", e))?;

        Ok(Commitment {
            block_number,
            tx_hash,
            commitment: event.data.commitment,
            leaf_index: event.data.leafIndex,
            timestamp: event.data.timestamp.saturating_to::<u64>(),
        })
    }
}

impl TryFrom<Log> for Nullifier {
    type Error = String;

    fn try_from(log: Log) -> Result<Self, Self::Error> {
        if log.topics().first().copied() != Some(Tornado::Withdrawal::SIGNATURE_HASH) {
            return Err(format!(
                "Invalid event signature: expected {}, got {}",
                Tornado::Withdrawal::SIGNATURE_HASH,
                log.topics().first().copied().unwrap_or_default()
            ));
        }

        let block_number = log.block_number.unwrap_or(0);
        let tx_hash = log.transaction_hash.unwrap_or_default();
        let event = Tornado::Withdrawal::decode_log(&log.inner)
            .map_err(|e| format!("Failed to decode log: {}", e))?;

        Ok(Nullifier {
            block_number,
            tx_hash,
            nullifier: event.data.nullifierHash,
            to: event.data.to,
            fee: event.data.fee.saturating_to::<u128>(),
            timestamp: 0,
        })
    }
}
