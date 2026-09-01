use alloy::sol_types::SolEvent;
use eip_1193_provider::provider::RawLog;

use crate::{
    abis::railgun::RailgunSmartWallet,
    indexer::syncer::{self, SyncEvent, normalize_tree_position::normalize_tree_position},
};

#[derive(Debug, thiserror::Error)]
pub enum LogDecodeError {
    #[error("Error decoding log: {0}")]
    Decode(#[from] alloy::sol_types::Error),
    #[error("Error parsing log: {0}")]
    Parse(String),
}

/// Decodes a raw log emitted by the RailgunSmartWallet into zero or more
/// [`SyncEvent`]s. Shared between any syncer that fetches raw logs (RPC, and
/// any host-supplied external syncer) rather than pre-decoded events.
pub fn log_to_sync_events(log: RawLog) -> Result<Vec<SyncEvent>, LogDecodeError> {
    let Some(topic0) = log.topics.get(0).cloned() else {
        return Err(LogDecodeError::Parse(format!(
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
            return Err(LogDecodeError::Parse(format!(
                "Unknown event with topic0: {:?}",
                topic0
            )));
        }
    }
}

fn handle_shield_event(log: &RawLog, block_number: u64) -> Result<Vec<SyncEvent>, LogDecodeError> {
    let event = RailgunSmartWallet::Shield::decode_log(&log.clone().into())?;

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
                hash: None,
            },
            block_number,
        ));
    }

    Ok(events)
}

fn handle_transact_event(
    log: &RawLog,
    block_timestamp: u64,
) -> Result<Vec<SyncEvent>, LogDecodeError> {
    let event = RailgunSmartWallet::Transact::decode_log(&log.clone().into())?;

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

fn handle_nullified_event(
    log: &RawLog,
    block_timestamp: u64,
) -> Result<Vec<SyncEvent>, LogDecodeError> {
    let event = RailgunSmartWallet::Nullified::decode_log(&log.clone().into())?;

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
