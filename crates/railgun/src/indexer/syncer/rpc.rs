use std::sync::Arc;

use alloy::sol_types::SolEvent;
use eip_1193_provider::provider::{Eip1193Error, Eip1193Provider, IntoEip1193Provider, RawLog};
use tracing::{info, warn};

use crate::{
    abis::railgun::RailgunSmartWallet,
    chain_config::ChainConfig,
    indexer::syncer::{
        self, SyncEvent, SyncerError, UtxoSyncer, normalize_tree_position::normalize_tree_position,
    },
};

/// JSON-RPC UTXO syncer.
///
/// Queries an Ethereum node for events emitted by the RailgunSmartWallet and parses them into
/// SyncEvents.
pub struct RpcSyncer {
    chain: ChainConfig,
    provider: Arc<dyn Eip1193Provider>,
    batch_size: u64,
    batch_delay: web_time::Duration,
}

#[derive(Debug, thiserror::Error)]
enum RpcSyncerError {
    #[error("Error decoding log: {0}")]
    LogDecodeError(#[from] alloy::sol_types::Error),
    #[error("Error parsing log: {0}")]
    LogParseError(String),
    #[error("RPC error: {0}")]
    RpcError(#[from] Eip1193Error),
}

impl RpcSyncer {
    pub fn new(chain: ChainConfig, provider: impl IntoEip1193Provider) -> Self {
        Self {
            chain,
            provider: provider.into_eip1193(),
            batch_size: 10,
            batch_delay: web_time::Duration::from_millis(1000),
        }
    }

    /// Sets the batch size for `eth_getLogs` calls.
    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }

    /// Sets the delay between `eth_getLogs` calls.
    pub fn with_batch_delay(mut self, batch_delay: web_time::Duration) -> Self {
        self.batch_delay = batch_delay;
        self
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl UtxoSyncer for RpcSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        Ok(self.latest_block().await?)
    }

    async fn sync(&self, from_block: u64, to_block: u64) -> Result<Vec<SyncEvent>, SyncerError> {
        Ok(self.events(from_block, to_block).await?)
    }
}

impl RpcSyncer {
    async fn latest_block(&self) -> Result<u64, RpcSyncerError> {
        Ok(self.provider.get_block_number().await?)
    }

    async fn events(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, RpcSyncerError> {
        let mut all_events = Vec::new();
        let mut current_from = from_block;
        while current_from <= to_block {
            let batch_start = current_from;
            let batch_end = to_block.min(current_from + self.batch_size - 1);

            let logs = self
                .provider
                .logs(
                    self.chain.railgun_smart_wallet,
                    None,
                    Some(batch_start),
                    Some(batch_end),
                )
                .await?;
            common::sleep(self.batch_delay).await;

            for log in logs {
                match log_to_sync_events(log) {
                    Ok(events) => all_events.extend(events),
                    Err(e) => warn!("Failed to parse log into SyncEvent: {}", e),
                }
            }
            current_from = batch_end + 1;
            info!("{}/{} ({} events)", batch_end, to_block, all_events.len());
        }

        Ok(all_events)
    }
}

// TODO: Test me
fn log_to_sync_events(log: RawLog) -> Result<Vec<SyncEvent>, RpcSyncerError> {
    let Some(topic0) = log.topics.get(0).cloned() else {
        return Err(RpcSyncerError::LogParseError(format!(
            "Log missing topic0: {:?}",
            log
        )));
    };
    let block_number = log.block_number.unwrap_or(0);
    let block_timestamp = log.block_timestamp.unwrap_or(0);

    match topic0 {
        RailgunSmartWallet::Shield::SIGNATURE_HASH => handle_shield_event(&log, block_number),
        RailgunSmartWallet::Transact::SIGNATURE_HASH => {
            handle_transact_event(&log, block_timestamp)
        }
        RailgunSmartWallet::Nullified::SIGNATURE_HASH => {
            handle_nullified_event(&log, block_timestamp)
        }
        RailgunSmartWallet::Unshield::SIGNATURE_HASH => {
            // Unshield events not needed. Spent notes are already
            // tracked via Nullified events.
            return Ok(vec![]);
        }
        _ => {
            return Err(RpcSyncerError::LogParseError(format!(
                "Unknown event with topic0: {:?}",
                topic0
            )));
        }
    }
}

// TODO: Test me
fn handle_shield_event(log: &RawLog, block_number: u64) -> Result<Vec<SyncEvent>, RpcSyncerError> {
    let event = RailgunSmartWallet::Shield::decode_log(&log.inner())?;

    let tree_number = event.treeNumber.saturating_to();
    let start_position = event.startPosition.saturating_to::<u32>();

    let mut events = Vec::new();
    for (i, commitment) in event.commitments.clone().into_iter().enumerate() {
        let shield_ciphertext = event.shieldCiphertext[i].clone();
        let (tree_number, leaf_index) =
            normalize_tree_position(tree_number, start_position + i as u32);

        events.push(SyncEvent::Shield(
            syncer::Shield {
                tree_number,
                leaf_index,
                npk: commitment.npk.into(),
                token: commitment.token.into(),
                value: commitment.value.saturating_to(),
                ciphertext: shield_ciphertext.clone().into(),
                shield_key: shield_ciphertext.shieldKey.into(),
            },
            block_number,
        ));
    }

    Ok(events)
}

// TODO: Test me
fn handle_transact_event(
    log: &RawLog,
    block_timestamp: u64,
) -> Result<Vec<SyncEvent>, RpcSyncerError> {
    let event = RailgunSmartWallet::Transact::decode_log(&log.inner())?;

    let tree_number = event.treeNumber.saturating_to();
    let start_position = event.startPosition.saturating_to::<u32>();

    let mut events = Vec::new();
    for (i, ciphertext) in event.ciphertext.clone().into_iter().enumerate() {
        let hash = event.hash[i].clone();
        let (tree_number, leaf_index) =
            normalize_tree_position(tree_number, start_position + i as u32);

        events.push(SyncEvent::Transact(
            syncer::Transact {
                tree_number,
                leaf_index,
                hash: hash.into(),
                ciphertext: ciphertext.clone().into(),
                blinded_receiver_viewing_key: ciphertext.blindedReceiverViewingKey.into(),
                blinded_sender_viewing_key: ciphertext.blindedSenderViewingKey.into(),
                annotation_data: ciphertext.annotationData.into(),
            },
            block_timestamp,
        ));
    }

    Ok(events)
}

// TODO: Test me
fn handle_nullified_event(
    log: &RawLog,
    block_timestamp: u64,
) -> Result<Vec<SyncEvent>, RpcSyncerError> {
    let event = RailgunSmartWallet::Nullified::decode_log(&log.inner())?;

    let tree_number = event.treeNumber as u32;

    let mut events = Vec::new();
    for nullifier in event.nullifier.clone().into_iter() {
        events.push(SyncEvent::Nullified(
            syncer::Nullified {
                tree_number: tree_number,
                nullifier: nullifier,
            },
            block_timestamp,
        ));
    }
    Ok(events)
}

impl From<RpcSyncerError> for SyncerError {
    fn from(e: RpcSyncerError) -> Self {
        SyncerError::new(e)
    }
}
