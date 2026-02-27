//! Types for the broadcaster / broadcaster manager

use std::collections::HashMap;

use alloy::primitives::Address;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
#[cfg(feature = "wasm")]
use tsify::Tsify;

use crate::railgun::{address::RailgunAddress, poi::ListKey};

/// A message received from the Waku network.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct WakuMessage {
    /// Message payload as bytes
    pub payload: Vec<u8>,
    /// Content topic the message was received on
    pub content_topic: String,
    /// Optional timestamp in milliseconds
    pub timestamp: Option<u64>,
}

/// Fee message data broadcast by a broadcaster.
///
/// This is the decoded content of a fee message from the Waku network.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde_as]
#[serde(rename_all = "camelCase")]
pub struct BroadcasterFeeMessageData {
    /// Map of token address (checksummed) to fee per unit gas (hex string)
    #[serde_as(as = "HashMap<DisplayFromStr, Hex>")]
    pub fees: HashMap<Address, u128>,
    /// Unix timestamp when these fees expire
    pub fee_expiration: u64,
    /// Unique identifier for this fee update
    #[serde(rename = "feesID")]
    pub fees_id: String,
    /// Broadcaster's RAILGUN address
    pub railgun_address: RailgunAddress,
    /// Optional human-readable identifier
    pub identifier: Option<String>,
    /// Number of wallets available for broadcasting
    pub available_wallets: u32,
    /// Broadcaster version string (e.g., "8.0.0")
    pub version: String,
    /// Address of the relay adapt contract
    pub relay_adapt: Address,
    /// Required POI list keys for this broadcaster
    #[serde(rename = "requiredPOIListKeys")]
    pub required_poi_list_keys: Vec<ListKey>,
    /// Reliability score (0.0-1.0)
    pub reliability: f64,
}

/// The expected broadcaster version. Messages from incompatible versions are ignored.
pub const BROADCASTER_VERSION: &str = "8";

/// Wrapped fee message from the Waku network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcasterFeeMessage {
    /// Hex-encoded JSON data
    pub data: String,
    /// Signature of the data
    pub signature: String,
}
