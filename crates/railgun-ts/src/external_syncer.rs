use alloy::primitives::{Address, Bytes, FixedBytes};
use eip_1193_provider::provider::RawLog;
use railgun::{
    chain_config::ChainConfig,
    indexer::syncer::{SyncEvent, SyncerError, UtxoSyncer, log_to_sync_events},
};
use wasm_bindgen::prelude::*;

/// JS-facing shape of a host-supplied external sync source, adapted (on the JS
/// side) from Kohaku's `Host.externalSyncProvider` into a materialized-array
/// form that can cross the WASM boundary. See `sdk/external-sync-provider.ts`.
#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
export interface UtxoExternalSyncProvider {
    getEvents(
        chainId: `0x${string}`,
        address: `0x${string}`,
        fromBlock: bigint,
        toBlock: bigint,
    ): Promise<ExternalRawEvent[]>;
    lastCoveredBlock(chainId: `0x${string}`, address: `0x${string}`): Promise<bigint>;
}

export interface ExternalRawEvent {
    contractAddress: `0x${string}`;
    eventTopic: `0x${string}`;
    topics: `0x${string}`[];
    data: `0x${string}`;
    blockNumber: `0x${string}`;
    logIndex: `0x${string}`;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "UtxoExternalSyncProvider")]
    pub type JsExternalSyncProvider;

    #[wasm_bindgen(method, catch, js_name = "getEvents")]
    async fn get_events(
        this: &JsExternalSyncProvider,
        chain_id: &str,
        address: &str,
        from_block: u64,
        to_block: u64,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, catch, js_name = "lastCoveredBlock")]
    async fn last_covered_block(
        this: &JsExternalSyncProvider,
        chain_id: &str,
        address: &str,
    ) -> Result<JsValue, JsValue>;
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalRawEvent {
    contract_address: Address,
    topics: Vec<FixedBytes<32>>,
    data: Bytes,
    /// `0x`-prefixed hex, unlike `RawLog.block_number` which crosses the JS
    /// boundary as a plain number (see `eip-1193-provider/src/provider.rs`).
    block_number: String,
}

#[derive(Debug, thiserror::Error)]
enum HostSyncerError {
    #[error("Host external sync provider call failed: {0}")]
    Js(String),
    #[error("Failed to decode host external sync provider response: {0}")]
    Decode(String),
    #[error("Malformed block number in external event: {0}")]
    BlockNumber(String),
}

impl TryFrom<ExternalRawEvent> for RawLog {
    type Error = HostSyncerError;

    fn try_from(raw: ExternalRawEvent) -> Result<Self, Self::Error> {
        let block_number = u64::from_str_radix(
            raw.block_number.trim_start_matches("0x"),
            16,
        )
        .map_err(|_| HostSyncerError::BlockNumber(raw.block_number.clone()))?;

        Ok(RawLog {
            block_number: Some(block_number),
            // Not carried by `ExternalRawEvent`; decoding already tolerates a
            // missing timestamp (defaults to 0), same as a partial RPC log.
            block_timestamp: None,
            transaction_hash: None,
            address: raw.contract_address,
            topics: raw.topics,
            data: raw.data,
        })
    }
}

/// `UtxoSyncer` backed by a host-supplied `Host.externalSyncProvider`
/// (bridged from JS via `UtxoExternalSyncProvider`). Mirrors tornado-cash's
/// `SyncService`: a fast, pre-scraped source consulted before falling back to
/// the chain, keyed per `(chainId, address)`.
pub struct HostSyncer {
    provider: JsExternalSyncProvider,
    chain_id: String,
    address: String,
}

impl HostSyncer {
    pub fn new(chain: &ChainConfig, provider: JsExternalSyncProvider) -> Self {
        Self {
            provider,
            chain_id: format!("{:#x}", chain.id),
            address: format!("{:#x}", chain.railgun_smart_wallet),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl UtxoSyncer for HostSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        let result = self
            .provider
            .last_covered_block(&self.chain_id, &self.address)
            .await
            .map_err(|e| SyncerError::new(HostSyncerError::Js(format!("{:?}", e))))?;

        js_bigint_to_u64(result).map_err(SyncerError::new)
    }

    async fn sync(&self, from_block: u64, to_block: u64) -> Result<Vec<SyncEvent>, SyncerError> {
        let result = self
            .provider
            .get_events(&self.chain_id, &self.address, from_block, to_block)
            .await
            .map_err(|e| SyncerError::new(HostSyncerError::Js(format!("{:?}", e))))?;

        let raw_events: Vec<ExternalRawEvent> = serde_wasm_bindgen::from_value(result)
            .map_err(|e| SyncerError::new(HostSyncerError::Decode(e.to_string())))?;

        let mut events = Vec::new();
        for raw in raw_events {
            let log: RawLog = match raw.try_into() {
                Ok(log) => log,
                Err(e) => {
                    tracing::warn!("Skipping external event: {}", e);
                    continue;
                }
            };

            match log_to_sync_events(log) {
                Ok(decoded) => events.extend(decoded),
                Err(e) => tracing::warn!("Failed to parse external event into SyncEvent: {}", e),
            }
        }

        Ok(events)
    }
}

fn js_bigint_to_u64(val: JsValue) -> Result<u64, HostSyncerError> {
    let bigint = js_sys::BigInt::from(val);
    let s = bigint
        .to_string(10)
        .map_err(|e| HostSyncerError::Decode(format!("{:?}", e)))?
        .as_string()
        .ok_or_else(|| HostSyncerError::Decode("BigInt.toString returned non-string".into()))?;
    s.parse::<u64>()
        .map_err(|e| HostSyncerError::Decode(e.to_string()))
}
