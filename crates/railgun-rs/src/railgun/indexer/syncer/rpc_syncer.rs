use std::sync::Arc;

use alloy_sol_types::SolEvent;
use eth_rpc::{EthRpcClient, EthRpcClientError, RawLog};
use tracing::{info, warn};

use crate::{
    abis::railgun::RailgunSmartWallet,
    chain_config::ChainConfig,
    crypto::aes::Ciphertext,
    railgun::indexer::syncer::{
        self,
        normalize_tree_position::normalize_tree_position,
        syncer::{NoteSyncer, SyncEvent, SyncerError},
    },
};

pub struct RpcSyncer {
    provider: Arc<dyn EthRpcClient>,
    batch_size: u64,
    timeout: web_time::Duration,
    chain: ChainConfig,
}

#[derive(Debug, thiserror::Error)]
pub enum RpcSyncerError {
    #[error("Error decoding log: {0}")]
    LogDecodeError(#[from] alloy_sol_types::Error),
    #[error("Error parsing log: {0}")]
    LogParseError(String),
    #[error("RPC error: {0}")]
    RpcError(#[from] EthRpcClientError),
}

impl RpcSyncer {
    pub fn new(provider: Arc<dyn EthRpcClient>, chain: ChainConfig) -> Self {
        Self {
            provider,
            batch_size: 10000,
            timeout: web_time::Duration::from_millis(100),
            chain,
        }
    }

    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }

    pub fn with_timeout(mut self, timeout: web_time::Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl NoteSyncer for RpcSyncer {
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
        loop {
            let batch_start = current_from;
            let batch_end = to_block.min(current_from + self.batch_size - 1);

            if batch_start > to_block {
                break;
            }

            let logs = self
                .provider
                .get_logs(
                    self.chain.railgun_smart_wallet,
                    None,
                    Some(batch_start),
                    Some(batch_end),
                )
                .await?;
            common::sleep(self.timeout).await;

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
        RailgunSmartWallet::Shield::SIGNATURE_HASH => decode_shield_event(&log, block_number),
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

fn decode_shield_event(log: &RawLog, block_number: u64) -> Result<Vec<SyncEvent>, RpcSyncerError> {
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
                ciphertext: Ciphertext {
                    iv: shield_ciphertext.encryptedBundle[0][..16]
                        .try_into()
                        .unwrap(),
                    tag: shield_ciphertext.encryptedBundle[0][16..]
                        .try_into()
                        .unwrap(),
                    data: vec![shield_ciphertext.encryptedBundle[1][..16].to_vec()],
                },
                shield_key: shield_ciphertext.shieldKey.into(),
            },
            block_number,
        ));
    }

    Ok(events)
}

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

        let mut data: Vec<Vec<u8>> = ciphertext.ciphertext[1..]
            .iter()
            .map(|chunk| chunk.to_vec())
            .collect();
        data.push(ciphertext.memo.to_vec());
        events.push(SyncEvent::Transact(
            syncer::Transact {
                tree_number,
                leaf_index,
                hash: hash.into(),
                ciphertext: Ciphertext {
                    iv: ciphertext.ciphertext[0][0..16].try_into().unwrap(),
                    tag: ciphertext.ciphertext[0][16..32].try_into().unwrap(),
                    data,
                },
                blinded_receiver_viewing_key: ciphertext.blindedReceiverViewingKey.into(),
                blinded_sender_viewing_key: ciphertext.blindedSenderViewingKey.into(),
                annotation_data: ciphertext.annotationData.into(),
            },
            block_timestamp,
        ));
    }

    Ok(events)
}

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
        SyncerError::Syncer(Box::new(e))
    }
}
