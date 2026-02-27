use std::sync::Arc;

use alloy::{
    primitives::{Address, TxHash, U256},
    providers::{DynProvider, Provider},
    rpc::types::TransactionRequest,
};
use prover::Prover;
use rand::Rng;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::{BroadcasterError, indexer::BroadcasterIndexer};
use crate::{
    Asset, Pool, PoolProvider, PoolProviderState, TornadoProvider, TornadoProviderError,
    TornadoProviderState,
    abis::tornado::Tornado::{self, withdrawCall},
    broadcaster::{Relayer, RelayerSyncer, indexer::BroadcasterIndexerState},
    indexer::{Syncer, Verifier},
    note::Note,
    tx_data::TxData,
};

const JOB_POLL_INTERVAL: web_time::Duration = web_time::Duration::from_secs(3);
const JOB_TIMEOUT: web_time::Duration = web_time::Duration::from_secs(120);

pub struct BroadcastProvider {
    inner: TornadoProvider,
    indexer: BroadcasterIndexer,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcasterState {
    pub tornado: TornadoProviderState,
    pub indexer: BroadcasterIndexerState,
}

#[derive(Debug)]
pub struct PreparedBroadcast {
    pub call: withdrawCall,
    pub hostname: String,
    pub pool: Pool,
}

#[derive(Debug, Deserialize)]
struct WithdrawResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct JobStatusResponse {
    #[serde(rename = "txHash")]
    tx_hash: Option<TxHash>,
    status: String,
    #[serde(rename = "failedReason")]
    failed_reason: Option<String>,
}

impl BroadcastProvider {
    pub fn new(
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        prover: Arc<dyn Prover>,
        relay_syncer: Arc<dyn RelayerSyncer>,
        mainnet_provider: DynProvider,
    ) -> Self {
        let inner = TornadoProvider::new(syncer, verifier, prover);
        let indexer = BroadcasterIndexer::new(relay_syncer, mainnet_provider);
        Self {
            inner,
            indexer,
            http: reqwest::Client::new(),
        }
    }

    pub fn from_state(
        state: BroadcasterState,
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        prover: Arc<dyn Prover>,
        relay_syncer: Arc<dyn RelayerSyncer>,
        mainnet_provider: DynProvider,
    ) -> Self {
        let inner = TornadoProvider::from_state(syncer, verifier, prover, state.tornado);
        let indexer =
            BroadcasterIndexer::from_state(relay_syncer, mainnet_provider.clone(), state.indexer);
        Self {
            inner,
            indexer,
            http: reqwest::Client::new(),
        }
    }

    pub fn state(&self) -> BroadcasterState {
        BroadcasterState {
            tornado: self.inner.state(),
            indexer: self.indexer.state(),
        }
    }

    pub fn add_pool(&mut self, pool: Pool) {
        self.inner.add_pool(pool);
    }

    pub fn add_pool_provider(&mut self, pool_provider: PoolProvider) {
        self.inner.add_pool_provider(pool_provider);
    }

    pub fn add_pool_from_state(&mut self, state: PoolProviderState) {
        self.inner.add_pool_from_state(state);
    }

    pub fn deposit<R: Rng>(
        &self,
        pool: &Pool,
        rng: &mut R,
    ) -> Result<(TxData, Note), TornadoProviderError> {
        self.inner.deposit(pool, rng)
    }

    pub async fn sync_to(&mut self, block: u64) -> Result<(), BroadcasterError> {
        self.indexer.sync_to(block).await?;
        self.inner.sync_to(block).await?;
        Ok(())
    }

    pub async fn sync(&mut self) -> Result<(), BroadcasterError> {
        self.indexer.sync().await?;
        self.inner.sync().await?;
        Ok(())
    }

    pub fn relayers(&self) -> Vec<&Relayer> {
        self.indexer.relayers()
    }

    /// Prepares a withdrawal transaction for broadcasting
    pub async fn prepare_broadcast<R: Rng>(
        &self,
        pool: &Pool,
        note: &Note,
        provider: &DynProvider,
        recipient: Address,
        refund: Option<U256>,
        rng: &mut R,
    ) -> Result<PreparedBroadcast, BroadcasterError> {
        let token_symbol = match &pool.asset {
            Asset::Native { .. } => None,
            Asset::Erc20 { symbol, .. } => Some(symbol.as_str()),
        };
        let relayer = self
            .indexer
            .pick_relayer(pool.chain_id, token_symbol, rng)
            .ok_or(BroadcasterError::NoRelayerAvailable)?;

        let hostname = relayer.hostname.clone();
        let reward_account = relayer.reward_account;

        let relayer_fee = compute_service_fee(pool.amount_wei, relayer.service_fee_percent);

        let dummy_tx = self
            .inner
            .withdraw(
                pool,
                note,
                recipient,
                Some(reward_account),
                Some(relayer_fee),
                refund,
            )
            .await?;

        let gas_cost_wei = self.estimate_gas_cost_wei(&provider, dummy_tx).await?;

        //? Convert gas cost to token denomination for ERC20 pools
        let gas_cost_in_token = match &pool.asset {
            Asset::Native { .. } => U256::from(gas_cost_wei),
            Asset::Erc20 { symbol, .. } => {
                let eth_price = *relayer.eth_prices.get(symbol).ok_or_else(|| {
                    BroadcasterError::GasEstimation(format!(
                        "No ETH price for {symbol} from relayer"
                    ))
                })?;

                if eth_price <= 0.0 {
                    return Err(BroadcasterError::GasEstimation(
                        "ETH price is zero or negative".to_string(),
                    ));
                }

                // gas_cost_in_token = gas_cost_wei / eth_price
                let gas_f64 = gas_cost_wei as f64;
                let token_cost = gas_f64 / eth_price;
                U256::from(token_cost as u128)
            }
        };

        let total_fee = relayer_fee + gas_cost_in_token;

        let call = self
            .inner
            .withdraw_calldata(
                pool,
                note,
                recipient,
                Some(reward_account),
                Some(total_fee),
                refund,
            )
            .await?;

        Ok(PreparedBroadcast {
            call,
            hostname,
            pool: pool.clone(),
        })
    }

    /// Broadcasts a prepared transaction to the relayer and waits for confirmation
    pub async fn broadcast(&self, prepared: PreparedBroadcast) -> Result<TxHash, BroadcasterError> {
        let pool = &prepared.pool;
        let hostname = prepared.hostname;
        let call = prepared.call;
        let resp = self.submit_withdraw(pool, &hostname, call).await?;
        info!("Relayer job submitted: {}", resp.id);
        self.await_withdraw(hostname, resp).await
    }

    async fn estimate_gas_cost_wei(
        &self,
        provider: &DynProvider,
        tx: TxData,
    ) -> Result<u128, BroadcasterError> {
        let tx_request: TransactionRequest = tx.into();

        let gas_limit = provider
            .estimate_gas(tx_request)
            .await
            .map_err(|e| BroadcasterError::GasEstimation(e.to_string()))?;

        let gas_price = provider
            .get_gas_price()
            .await
            .map_err(|e| BroadcasterError::GasEstimation(e.to_string()))?;

        let gas_cost_wei = gas_limit as u128 * gas_price;
        Ok(gas_cost_wei)
    }

    /// Submit a withdrawal call to the relayer and return its jobID
    async fn submit_withdraw(
        &self,
        pool: &Pool,
        hostname: &String,
        call: Tornado::withdrawCall,
    ) -> Result<WithdrawResponse, BroadcasterError> {
        let withdraw_payload = serde_json::json!({
            "contract": format!("{:#x}", pool.address),
            "proof": format!("0x{}", hex::encode(&call._proof)),
            "args": [
                format!("{:#x}", call._root),
                format!("{:#x}", call._nullifierHash),
                format!("{:#x}", call._recipient),
                format!("{:#x}", call._relayer),
                format!("{}", call._fee),
                format!("{}", call._refund),
            ]
        });

        let url = format!("https://{hostname}/v1/tornadoWithdraw");
        info!("Submitting withdrawal to relayer: {}", url);

        let resp: WithdrawResponse = self
            .http
            .post(&url)
            .json(&withdraw_payload)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp)
    }

    /// Awaits a withdrawal job to be confirmed
    async fn await_withdraw(
        &self,
        hostname: String,
        resp: WithdrawResponse,
    ) -> Result<TxHash, BroadcasterError> {
        let job_url = format!("https://{hostname}/v1/jobs/{}", resp.id);
        let start = std::time::Instant::now();
        loop {
            if start.elapsed() > JOB_TIMEOUT {
                return Err(BroadcasterError::JobTimeout {
                    timeout_secs: JOB_TIMEOUT.as_secs(),
                });
            }

            sleep(JOB_POLL_INTERVAL).await;

            let job_resp = self.http.get(&job_url).send().await?;
            let job: JobStatusResponse = job_resp.json().await?;

            match job.status.as_str() {
                "CONFIRMED" => {
                    let tx_hash = job.tx_hash.unwrap_or_default();
                    info!("Withdrawal confirmed: {}", tx_hash);
                    return Ok(tx_hash);
                }
                "FAILED" => {
                    let reason = job.failed_reason.unwrap_or_else(|| "unknown".to_string());
                    warn!("Relayer job failed: {}", reason);
                    return Err(BroadcasterError::JobFailed { reason });
                }
                status => {
                    info!("Job status: {}, waiting...", status);
                }
            }
        }
    }
}

fn compute_service_fee(amount_wei: u128, fee_percent: f64) -> U256 {
    let amount_f64 = amount_wei as f64;
    let fee = amount_f64 * fee_percent / 100.0;
    U256::from(fee as u128)
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn sleep(duration: web_time::Duration) {
    tokio::time::sleep(duration).await;
}

#[cfg(target_arch = "wasm32")]
pub async fn sleep(duration: web_time::Duration) {
    gloo_timers::future::sleep(duration).await;
}
