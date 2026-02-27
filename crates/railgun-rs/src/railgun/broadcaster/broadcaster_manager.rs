use std::{collections::HashMap, sync::Arc};

use alloy::primitives::Address;
use futures::{FutureExt, StreamExt, lock::Mutex};
use thiserror::Error;
use tracing::{info, warn};

use super::{
    broadcaster::{Broadcaster, Fee},
    transport::{WakuTransport, WakuTransportError},
    types::{BROADCASTER_VERSION, BroadcasterFeeMessage, BroadcasterFeeMessageData, WakuMessage},
};
use crate::{
    railgun::{
        address::RailgunAddress, broadcaster::content_topics::fee_content_topic, poi::ListKey,
    },
    sleep::sleep,
};

/// Manages broadcaster state and fee information.
///
/// Subscribes to Waku fee messages and maintains a cache of broadcaster
/// information, allowing selection of the best broadcaster for a given token.
#[derive(Clone)]
pub struct BroadcasterManager {
    chain_id: u64,
    transport: Arc<dyn WakuTransport>,
    broadcasters: Arc<Mutex<HashMap<RailgunAddress, BroadcasterData>>>,
    /// Optional list of whitelisted broadcasters to filter by (if empty, all
    /// broadcasters are considered)
    whitelisted_broadcasters: Vec<RailgunAddress>,
}

#[derive(Debug, Clone)]
struct BroadcasterData {
    railgun_address: RailgunAddress,
    identifier: Option<String>,
    required_poi_list_keys: Vec<ListKey>,
    token_fees: HashMap<Address, TokenFeeData>,
}

#[derive(Debug, Clone)]
struct TokenFeeData {
    fee_per_unit_gas: u128,
    expiration: u64,
    fees_id: String,
    available_wallets: u32,
    relay_adapt: Address,
    reliability: u32,
}

#[derive(Debug, Error)]
pub enum BroadcastersError {
    #[error("Transport error: {0}")]
    Transport(#[from] WakuTransportError),
    #[error("Message parsing error: {0}")]
    ParseError(String),
    #[error("Invalid broadcaster version: got {got}, expected {expected}")]
    IncompatibleVersion { got: String, expected: String },
}

impl BroadcasterManager {
    pub fn new(
        chain_id: u64,
        transport: impl WakuTransport + 'static,
        whitelisted: Vec<RailgunAddress>,
    ) -> Self {
        info!(chain_id, ?whitelisted, "Creating BroadcasterManager");

        Self {
            chain_id,
            transport: Arc::new(transport),
            broadcasters: Arc::new(Mutex::new(HashMap::new())),
            whitelisted_broadcasters: whitelisted,
        }
    }

    /// Start listening for broadcaster fee messages.
    ///
    /// Automatically reconnects with exponential backoff if the subscription
    /// stream closes unexpectedly.
    pub async fn start(&self) -> Result<(), BroadcastersError> {
        let topic = fee_content_topic(self.chain_id);
        let mut backoff = web_time::Duration::from_secs(1);
        let max_backoff = web_time::Duration::from_secs(60);

        loop {
            let mut stream = self.transport.subscribe(vec![topic.clone()]).await?;
            info!(topic, "Subscribed to broadcaster fee topic");

            let staleness_timeout = web_time::Duration::from_secs(90);

            loop {
                let next_msg = stream.next().fuse();
                let timeout = crate::sleep::sleep(staleness_timeout).fuse();
                futures::pin_mut!(next_msg, timeout);

                futures::select! {
                    msg = next_msg => {
                        match msg {
                            Some(msg) => {
                                // Reset backoff on successful message receipt.
                                backoff = web_time::Duration::from_secs(1);
                                if let Err(e) = self.handle_fee_message(&msg).await {
                                    warn!("Error handling fee message: {}", e);
                                }
                            }
                            None => break, // Stream closed
                        }
                    }
                    _ = timeout => {
                        warn!("No fee messages received in {:?}, resubscribing", staleness_timeout);
                        break;
                    }
                }
            }

            warn!(
                "Broadcaster fee subscription ended, reconnecting in {:?}",
                backoff
            );
            sleep(backoff).await;
            backoff = (backoff * 2).min(max_backoff);
        }
    }

    pub fn chain_id(&self) -> u64 {
        self.chain_id
    }

    /// Find the best broadcaster for a given token.
    /// - Has a valid (non-expired) fee
    /// - Has at least one available wallet
    /// - Has the highest reliability among ties
    pub async fn best_broadcaster_for_token(
        &self,
        token: Address,
        current_time: u64,
    ) -> Option<Broadcaster> {
        let broadcasters = self.broadcasters.lock().await;

        broadcasters
            .values()
            //? Filter by whitelist if it's not empty
            .filter(|data| {
                self.whitelisted_broadcasters.is_empty()
                    || self
                        .whitelisted_broadcasters
                        .contains(&data.railgun_address)
            })
            //? Filter for entries with a valid fee for the token
            .filter_map(|data| {
                data.token_fees
                    .get(&token)
                    .filter(|f| f.expiration > current_time && f.available_wallets > 0)
                    .map(|f| (data, f))
            })
            //? Find the entry with the lowest fee, breaking ties by reliability
            .min_by(|(_, a), (_, b)| {
                // Sort by fee ascending, then by reliability descending
                a.fee_per_unit_gas
                    .cmp(&b.fee_per_unit_gas)
                    .then_with(|| b.reliability.cmp(&a.reliability))
            })
            .map(|(data, token_fee)| {
                Broadcaster::new(
                    Arc::clone(&self.transport),
                    self.chain_id,
                    data.railgun_address,
                    data.identifier.clone(),
                    Fee {
                        token,
                        per_unit_gas: token_fee.fee_per_unit_gas,
                        recipient: data.railgun_address,
                        expiration: token_fee.expiration,
                        fees_id: token_fee.fees_id.clone(),
                        available_wallets: token_fee.available_wallets,
                        relay_adapt: token_fee.relay_adapt,
                        reliability: token_fee.reliability,
                        list_keys: data.required_poi_list_keys.clone(),
                    },
                )
            })
    }

    async fn handle_fee_message(&self, msg: &WakuMessage) -> Result<(), BroadcastersError> {
        let fee_data = decode_fee_message(&msg.payload)?;

        let major_version = fee_data
            .version
            .split('.')
            .next()
            .unwrap_or(&fee_data.version);

        if major_version != BROADCASTER_VERSION {
            return Err(BroadcastersError::IncompatibleVersion {
                got: fee_data.version.clone(),
                expected: BROADCASTER_VERSION.to_string(),
            });
        }

        let mut token_fees = HashMap::new();
        for (token_addr, fee_per_unit_gas) in fee_data.fees {
            token_fees.insert(
                token_addr,
                TokenFeeData {
                    fee_per_unit_gas,
                    expiration: fee_data.fee_expiration,
                    fees_id: fee_data.fees_id.clone(),
                    available_wallets: fee_data.available_wallets,
                    relay_adapt: fee_data.relay_adapt,
                    reliability: (fee_data.reliability * 100.0) as u32,
                },
            );
        }

        let data = BroadcasterData {
            railgun_address: fee_data.railgun_address,
            identifier: fee_data.identifier.clone(),
            required_poi_list_keys: fee_data.required_poi_list_keys,
            token_fees,
        };

        info!(
            address = %data.railgun_address,
            identifier = ?data.identifier,
            tokens = ?data.token_fees.keys(),
            "Received fee update",
        );
        self.broadcasters
            .lock()
            .await
            .insert(fee_data.railgun_address, data);

        Ok(())
    }
}

fn decode_fee_message(payload: &[u8]) -> Result<BroadcasterFeeMessageData, BroadcastersError> {
    let msg: BroadcasterFeeMessage = serde_json::from_slice(payload)
        .map_err(|e| BroadcastersError::ParseError(format!("Invalid JSON: {}", e)))?;

    let data_bytes = hex_decode(&msg.data)
        .map_err(|e| BroadcastersError::ParseError(format!("Invalid hex data: {}", e)))?;

    let fee_data: BroadcasterFeeMessageData = serde_json::from_slice(&data_bytes)
        .map_err(|e| BroadcastersError::ParseError(format!("Invalid fee data JSON: {}", e)))?;

    Ok(fee_data)
}

fn hex_decode(hex_str: &str) -> Result<Vec<u8>, hex::FromHexError> {
    let clean_hex = hex_str.trim_start_matches("0x");
    hex::decode(clean_hex)
}
