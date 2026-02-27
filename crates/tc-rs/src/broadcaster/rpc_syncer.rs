use alloy::{
    primitives::Address,
    providers::{DynProvider, Provider},
    rpc::types::Filter,
};
use alloy_sol_types::SolEvent;
use tracing::{info, warn};

use crate::{
    abis::relayer_registry::RelayerRegistry,
    broadcaster::{RelayerRecord, RelayerSyncer},
    indexer::SyncerError,
};

pub struct RpcRelayerSyncer {
    mainnet_provider: DynProvider,
    batch_size: u64,
}

impl RpcRelayerSyncer {
    /// Create a new RpcRelayerSyncer with the given mainnet provider.
    ///
    /// The provider must be connected to mainnet since the registry aggregates
    /// data for all chains.
    pub fn new(mainnet_provider: DynProvider) -> Self {
        Self {
            mainnet_provider,
            batch_size: 2000,
        }
    }

    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl RelayerSyncer for RpcRelayerSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        self.mainnet_provider
            .get_block_number()
            .await
            .map_err(|e| SyncerError::Syncer(Box::new(e)))
    }

    async fn sync_relayers(
        &self,
        registry: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<RelayerRecord>, SyncerError> {
        let mut all_records = Vec::new();
        let mut current_block = from_block;

        while current_block <= to_block {
            let batch_end = (current_block + self.batch_size - 1).min(to_block);

            let filter = Filter::new()
                .address(registry)
                .event_signature(RelayerRegistry::RelayerRegistered::SIGNATURE_HASH)
                .from_block(current_block)
                .to_block(batch_end);

            let logs = self
                .mainnet_provider
                .get_logs(&filter)
                .await
                .map_err(|e| SyncerError::Syncer(Box::new(e)))?;

            let records: Vec<RelayerRecord> = logs
                .into_iter()
                .filter_map(|log| match log.try_into() {
                    Ok(record) => Some(record),
                    Err(e) => {
                        warn!("Failed to parse log into RelayerRecord: {}", e);
                        None
                    }
                })
                .collect();

            info!(
                "Fetched {} relayer records from blocks {}-{}",
                records.len(),
                current_block,
                batch_end
            );

            all_records.extend(records);
            current_block = batch_end + 1;
        }

        Ok(all_records)
    }
}
