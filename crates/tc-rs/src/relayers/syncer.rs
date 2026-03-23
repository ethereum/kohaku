use alloy_primitives::{Address, FixedBytes, U256};
use alloy_sol_types::SolEvent;
use eth_rpc::RawLog;
use serde::{Deserialize, Serialize};

use crate::{abis::relayer_registry::RelayerRegistry, indexer::SyncerError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayerRecord {
    pub ens_name: String,
    pub ens_hash: FixedBytes<32>,
    pub address: Address,
    pub staked_amount: U256,
    pub block_number: u64,
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait RelayerSyncer: common::MaybeSend {
    async fn latest_block(&self) -> Result<u64, SyncerError>;
    async fn sync_relayers(
        &self,
        registry: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<RelayerRecord>, SyncerError>;
}

impl TryFrom<RawLog> for RelayerRecord {
    type Error = String;

    fn try_from(log: RawLog) -> Result<Self, Self::Error> {
        if log.topics.first().copied() != Some(RelayerRegistry::RelayerRegistered::SIGNATURE_HASH) {
            return Err(format!(
                "Invalid event signature: expected {}, got {}",
                RelayerRegistry::RelayerRegistered::SIGNATURE_HASH,
                log.topics.first().copied().unwrap_or_default()
            ));
        }

        let block_number = log.block_number.unwrap_or(0);
        let event = RelayerRegistry::RelayerRegistered::decode_log(&log.inner())
            .map_err(|e| format!("Failed to decode log: {}", e))?;

        Ok(RelayerRecord {
            ens_name: event.data.ensName,
            ens_hash: event.data.relayer,
            address: event.data.relayerAddress,
            staked_amount: event.data.stakedAmount,
            block_number,
        })
    }
}
