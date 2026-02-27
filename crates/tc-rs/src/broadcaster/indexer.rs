use std::{collections::HashMap, sync::Arc};

use alloy::{
    primitives::{Address, FixedBytes, address},
    providers::DynProvider,
};
use rand::Rng;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::{BroadcasterError, syncer::RelayerSyncer};
use crate::{abis::relayer_registry::RelayerAggregator, broadcaster::RelayerRecord};

pub struct BroadcasterIndexer {
    syncer: Arc<dyn RelayerSyncer>,
    mainnet_provider: DynProvider,
    relayers: Vec<Relayer>,
    synced_block: u64,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcasterIndexerState {
    pub relayers: Vec<Relayer>,
    pub synced_block: u64,
}

/// Chain-specific configuration for relayer discovery
pub struct BroadcasterConfig {
    pub registry_address: Address,
    pub aggregator_address: Address,
    pub all_subdomain_keys: Vec<String>,
    pub registry_deployed_block: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relayer {
    pub record: RelayerRecord,
    pub chain_id: u64,
    pub hostname: String,
    pub stake_balance: U256,
    //? Populated / updated by health checks
    pub healthy: bool,
    /// Timestamp of the last successful health check, used for pruning stale relayers
    pub last_healthy: web_time::SystemTime,
    pub reward_account: Address,
    pub service_fee_percent: f64,

    /// Cached ETH price per token symbol. Given in tokens per ETH
    pub eth_prices: HashMap<String, f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayerStatus {
    reward_account: Address,
    #[serde(rename = "tornadoServiceFee")]
    service_fee: f64,
    eth_prices: Option<HashMap<String, String>>,
    health: Option<HealthStatus>,
    net_id: u64,
}

#[derive(Debug, Deserialize)]
struct HealthStatus {
    status: String,
}

/// Minimum TORN stake required for a relayer to be considered valid
const MIN_STAKE_BALANCE: u128 = 500 * 10u128.pow(18);

const REGISTRY_ADDRESS: Address = address!("0x58E8dCC13BE9780fC42E8723D8EaD4CF46943dF2");
const AGGREGATOR_ADDRESS: Address = address!("0xE8F47A78A6D52D317D0D2FFFac56739fE14D1b49");
const REGISTRY_DEPLOYED_BLOCK: u64 = 14173129;
const SUBDOMAINS: [(&str, u64); 8] = [
    ("mainnet-tornado", 1),
    ("bsc-tornado", 56),
    ("polygon-tornado", 137),
    ("gnosis-tornado", 100),
    ("avalanche-tornado", 43114),
    ("optimism-tornado", 10),
    ("arbitrum-tornado", 42161),
    ("sepolia-tornado", 11155111),
];

impl BroadcasterIndexer {
    /// Create a new Broadcaster Indexer with the given syncer, config, and mainnet
    /// provider.
    ///
    /// The provided must be connected to mainnet to query the RelayerAggregator
    /// since the registry aggregates data for all chains.
    pub fn new(syncer: Arc<dyn RelayerSyncer>, mainnet_provider: DynProvider) -> Self {
        Self {
            syncer,
            mainnet_provider,
            relayers: Vec::new(),
            synced_block: REGISTRY_DEPLOYED_BLOCK,
            http: reqwest::Client::builder()
                .user_agent("tc-rs-health-check")
                .build()
                .unwrap(),
        }
    }

    pub fn from_state(
        syncer: Arc<dyn RelayerSyncer>,
        mainnet_provider: DynProvider,
        state: BroadcasterIndexerState,
    ) -> Self {
        Self {
            syncer,
            mainnet_provider,
            relayers: state.relayers,
            synced_block: state.synced_block,
            http: reqwest::Client::builder()
                .user_agent("tc-rs-health-check")
                .build()
                .unwrap(),
        }
    }

    pub fn state(&self) -> BroadcasterIndexerState {
        BroadcasterIndexerState {
            relayers: self.relayers.clone(),
            synced_block: self.synced_block,
        }
    }

    pub fn relayers(&self) -> Vec<&Relayer> {
        self.relayers.iter().filter(|r| r.healthy).collect()
    }

    /// Select a relayer using weighted random selection, filtered to the given
    /// chain and token. Pass `None` for native ETH pools, or `Some(symbol)` for
    /// ERC20 pools to filter to relayers that have an ETH price for that token.
    pub fn pick_relayer<R: Rng>(
        &self,
        chain_id: u64,
        token_symbol: Option<&str>,
        rng: &mut R,
    ) -> Option<&Relayer> {
        let chain_relayers: Vec<&Relayer> = self
            .relayers
            .iter()
            .filter(|r| r.chain_id == chain_id)
            .filter(|r| match token_symbol {
                Some(sym) => r.eth_prices.contains_key(sym),
                None => true,
            })
            .collect();

        if chain_relayers.is_empty() {
            return None;
        }

        // Mainnet: min_fee=0.33, max_fee=0.53
        // Other chains: min_fee=0.01, max_fee=0.30
        let (min_fee, max_fee) = if chain_id == 1 {
            (0.33, 0.53)
        } else {
            (0.01, 0.30)
        };
        let fee_range = max_fee - min_fee;

        // Score = stake_balance * (1 - ((fee - min_fee)^2 / (max_fee - min_fee)^2))
        let weights: Vec<f64> = chain_relayers
            .iter()
            .map(|r| {
                let fee = r.service_fee_percent;
                if fee >= max_fee {
                    return 0.0;
                }
                let fee_diff = (fee - min_fee).max(0.0);
                let penalty = (fee_diff * fee_diff) / (fee_range * fee_range);
                let stake_f64 = r.stake_balance.saturating_to::<u128>() as f64;
                stake_f64 * (1.0 - penalty)
            })
            .collect();

        let total_weight: f64 = weights.iter().sum();
        if total_weight <= 0.0 {
            return Some(chain_relayers[0]);
        }

        let target: f64 = rng.random::<f64>() * total_weight;
        let mut cumulative = 0.0;
        for (i, w) in weights.iter().enumerate() {
            cumulative += w;
            if cumulative >= target {
                return Some(chain_relayers[i]);
            }
        }

        Some(chain_relayers[chain_relayers.len() - 1])
    }

    pub async fn sync(&mut self) -> Result<(), BroadcasterError> {
        self.sync_to(self.syncer.latest_block().await?).await
    }

    pub async fn sync_to(&mut self, block: u64) -> Result<(), BroadcasterError> {
        let from_block = self.synced_block;
        let to_block = block;

        if from_block > to_block {
            info!("Broadcaster indexer already synced to block {}", to_block);
            return Ok(());
        }

        let records = self
            .syncer
            .sync_relayers(REGISTRY_ADDRESS, from_block, to_block)
            .await?;
        info!("Fetched {} relayer registration events", records.len());

        //? Deduplicate by ens_name (keep latest registration)
        let mut deduped: HashMap<String, RelayerRecord> = HashMap::new();
        for record in records {
            let entry = deduped
                .entry(record.ens_name.clone())
                .or_insert_with(|| record.clone());
            if record.block_number >= entry.block_number {
                *entry = record;
            }
        }
        let unique_records: Vec<_> = deduped.into_values().collect();
        info!("Deduplicated to {} unique relayers", unique_records.len());

        if unique_records.is_empty() {
            self.synced_block = to_block;
            return Ok(());
        }

        //? Fetch aggregator data and validate relayers
        let relayer_datas = self.fetch_relayer_data(&unique_records).await?;
        let subdomains = subdomain_keys();

        let valid: Vec<_> = relayer_datas
            .iter()
            .zip(unique_records.iter())
            .filter(|(data, _)| data.isRegistered)
            .filter(|(data, _)| data.balance >= U256::from(MIN_STAKE_BALANCE))
            .filter(|(data, record)| data.owner == record.address)
            .collect();

        //? Build one candidate per valid relayer x non-empty hostname
        for (data, record) in &valid {
            for (i, hostname) in data.records.iter().enumerate() {
                if hostname.is_empty() || i >= subdomains.len() {
                    continue;
                }

                let chain_id = chain_id_from_subdomain(&subdomains[i]);

                let existing = self
                    .relayers
                    .iter_mut()
                    .find(|r| r.record.ens_hash == record.ens_hash && r.hostname == *hostname);
                if let Some(existing) = existing {
                    existing.stake_balance = data.balance;
                    existing.record = (*record).clone();
                    continue;
                }

                self.relayers.push(Relayer {
                    record: (*record).clone(),
                    chain_id,
                    hostname: hostname.clone(),
                    stake_balance: data.balance,
                    reward_account: Address::ZERO,
                    service_fee_percent: 0.0,
                    eth_prices: HashMap::new(),
                    healthy: false,
                    last_healthy: web_time::SystemTime::now(),
                });
            }
        }

        self.synced_block = to_block;

        //? Health check all relayers
        self.health_check_all().await?;

        info!("{} relayers available after sync", self.relayers.len());
        for relayer in &self.relayers {
            info!(
                "Relayer {}: chain_id={}, stake={}, reward_account={}, healthy={}, service_fee={}%, eth_prices={}, record={:?}",
                relayer.hostname,
                relayer.chain_id,
                relayer.stake_balance,
                relayer.reward_account,
                relayer.healthy,
                relayer.service_fee_percent,
                relayer
                    .eth_prices
                    .iter()
                    .map(|(sym, price)| format!("{}: {} tokens/ETH", sym, price))
                    .collect::<Vec<_>>()
                    .join(", "),
                relayer.record,
            );
        }
        Ok(())
    }

    async fn fetch_relayer_data(
        &mut self,
        records: &Vec<RelayerRecord>,
    ) -> Result<Vec<RelayerAggregator::Relayer>, BroadcasterError> {
        let ens_hashes: Vec<FixedBytes<32>> = records.iter().map(|r| r.ens_hash).collect();
        let subdomains: Vec<String> = subdomain_keys();

        let aggregator = RelayerAggregator::new(AGGREGATOR_ADDRESS, &self.mainnet_provider);

        let result = aggregator
            .relayersData(ens_hashes.clone(), subdomains.clone())
            .call()
            .await
            .map_err(|e| BroadcasterError::Aggregator(e.to_string()))?;

        Ok(result)
    }

    /// Health-check all known relayers
    pub async fn health_check_all(&mut self) -> Result<(), BroadcasterError> {
        for relayer in &mut self.relayers {
            relayer.healthy = false;

            let resp = health_check(&self.http, &relayer.hostname).await;
            if let Err(e) = &resp {
                warn!("Health check failed for {}: {}", relayer.hostname, e);
                continue;
            }

            let Some(status) = resp.ok() else {
                continue;
            };

            if !status.health.as_ref().is_some_and(|h| h.status == "true") {
                warn!("Relayer {} is not healthy", relayer.hostname);
                continue;
            }

            if status.net_id != relayer.chain_id {
                warn!(
                    "Relayer {} has mismatched chain ID (expected {}, got {})",
                    relayer.hostname, relayer.chain_id, status.net_id
                );
                continue;
            }

            info!("Relayer {} healthy", relayer.hostname);
            relayer.reward_account = status.reward_account;
            relayer.service_fee_percent = status.service_fee;
            relayer.eth_prices = status
                .eth_prices
                .unwrap_or_default()
                .into_iter()
                .filter_map(|(sym, price_str)| {
                    price_str.parse::<f64>().ok().map(|price| (sym, price))
                })
                .collect();
            relayer.healthy = true;
            relayer.last_healthy = web_time::SystemTime::now();
        }
        Ok(())
    }

    /// Prune relayers that have been unhealthy for longer than the given max age
    pub fn prune_stale_relayers(&mut self, max_age: web_time::Duration) {
        let now = web_time::SystemTime::now();
        self.relayers.retain(|r| {
            if r.healthy {
                return true;
            }

            let age = now.duration_since(r.last_healthy).unwrap_or_default();
            if age <= max_age {
                return true;
            }

            info!(
                "Pruning stale relayer {} (last healthy {} seconds ago)",
                r.hostname,
                age.as_secs()
            );
            false
        });
    }
}

async fn health_check(
    client: &reqwest::Client,
    hostname: &str,
) -> Result<RelayerStatus, BroadcasterError> {
    let url = format!("https://{hostname}/status");
    let resp = client.get(&url).send().await?;
    let status: RelayerStatus = resp.json().await?;
    Ok(status)
}

/// Maps a subdomain key (e.g. "mainnet-tornado", "bsc-tornado") to its chain ID
///
/// Returns 0 for unknown subdomains
fn chain_id_from_subdomain(subdomain: &str) -> u64 {
    for (key, chain_id) in SUBDOMAINS.iter() {
        if subdomain.starts_with(key) {
            return *chain_id;
        }
    }
    0
}

fn subdomain_keys() -> Vec<String> {
    SUBDOMAINS.iter().map(|(key, _)| key.to_string()).collect()
}
