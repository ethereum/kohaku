use std::sync::Arc;

use alloy_primitives::{Address, TxHash, U256};
use eth_rpc::{EthRpcClient, TxData};
use prover::Prover;
use rand::Rng;
use request::{HttpClient, ResponseExt};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::{RelayerError, indexer::RelayerIndexer};
use crate::{
    Asset, Pool, TornadoProvider, TornadoProviderState,
    abis::tornado::Tornado::{self, withdrawCall},
    indexer::Syncer,
    note::Note,
    relayers::{Relayer, RpcRelayerSyncer, indexer::RelayerIndexerState},
};

const JOB_POLL_INTERVAL: web_time::Duration = web_time::Duration::from_secs(3);
const JOB_TIMEOUT: web_time::Duration = web_time::Duration::from_secs(120);

pub struct RelayerProvider {
    inner: TornadoProvider,
    indexer: RelayerIndexer,
    http: HttpClient,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayerState {
    pub tornado: TornadoProviderState,
    pub indexer: RelayerIndexerState,
}

/// A prepared relayable transaction
#[derive(Debug)]
pub struct PreparedTransaction {
    /// Hostname of the relayer to send this transaction to
    pub hostname: String,
    pub call: withdrawCall,
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

impl RelayerProvider {
    pub fn new(
        rpc: Arc<dyn EthRpcClient>,
        syncer: Arc<dyn Syncer>,
        prover: Arc<dyn Prover>,
        mainnet_rpc: Arc<dyn EthRpcClient>,
    ) -> Self {
        let inner = TornadoProvider::new(rpc, syncer, prover);
        let relay_syncer = Arc::new(RpcRelayerSyncer::new(mainnet_rpc.clone()));
        let indexer = RelayerIndexer::new(relay_syncer, mainnet_rpc);
        Self {
            inner,
            indexer,
            http: HttpClient::new(Some("tc-rs-health-check")),
        }
    }

    pub fn from_state(
        state: RelayerState,
        rpc: Arc<dyn EthRpcClient>,
        syncer: Arc<dyn Syncer>,
        prover: Arc<dyn Prover>,
        mainnet_rpc: Arc<dyn EthRpcClient>,
    ) -> Result<Self, RelayerError> {
        let inner = TornadoProvider::from_state(rpc, syncer, prover, state.tornado)?;
        let relay_syncer = Arc::new(RpcRelayerSyncer::new(mainnet_rpc.clone()));
        let indexer = RelayerIndexer::from_state(relay_syncer, mainnet_rpc, state.indexer);
        Ok(Self {
            inner,
            indexer,
            http: HttpClient::new(Some("tc-rs-health-check")),
        })
    }

    pub fn state(&self) -> RelayerState {
        RelayerState {
            tornado: self.inner.state(),
            indexer: self.indexer.state(),
        }
    }

    pub fn deposit<R: Rng>(&mut self, pool: &Pool, rng: &mut R) -> (TxData, Note) {
        self.inner.deposit(pool, rng)
    }

    pub async fn sync_to(&mut self, block: u64) -> Result<(), RelayerError> {
        self.indexer.sync_to(block).await?;
        self.inner.sync_to(block).await?;
        Ok(())
    }

    pub async fn sync(&mut self) -> Result<(), RelayerError> {
        self.indexer.sync().await?;
        self.inner.sync().await?;
        Ok(())
    }

    pub fn relayers(&self) -> Vec<&Relayer> {
        self.indexer.relayers()
    }

    /// Prepares a withdrawal transaction for sending to a given relayer
    pub async fn prepare<R: Rng>(
        &mut self,
        note: &Note,
        provider: &dyn EthRpcClient,
        recipient: Address,
        refund: Option<U256>,
        rng: &mut R,
    ) -> Result<PreparedTransaction, RelayerError> {
        let pool = Pool::from_note(note).ok_or(RelayerError::UnknownPool(
            note.amount.clone(),
            note.symbol.clone(),
            note.chain_id,
        ))?;

        let relayer = self
            .indexer
            .pick_relayer(note.chain_id, &note.symbol, rng)
            .ok_or(RelayerError::NoRelayerAvailable)?;

        let hostname = relayer.hostname.clone();
        let reward_account = relayer.reward_account;

        let relayer_fee = compute_service_fee(pool.amount_wei, relayer.service_fee_percent);

        let dummy_tx = self
            .inner
            .withdraw(
                note,
                recipient,
                Some(reward_account),
                Some(relayer_fee),
                refund,
            )
            .await?;

        let gas_cost_wei = self.estimate_gas_cost_wei(provider, dummy_tx).await?;

        //? Convert gas cost to token denomination for ERC20 pools
        let gas_cost_in_token = match &pool.asset {
            Asset::Native { .. } => U256::from(gas_cost_wei),
            Asset::Erc20 { symbol, .. } => {
                let eth_price = *relayer
                    .eth_prices
                    .get(symbol.to_string().as_str())
                    .ok_or_else(|| {
                        RelayerError::GasEstimation(format!(
                            "No ETH price for {symbol} from relayer"
                        ))
                    })?;

                if eth_price <= 0.0 {
                    return Err(RelayerError::GasEstimation(
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
                note,
                recipient,
                Some(reward_account),
                Some(total_fee),
                refund,
            )
            .await?;

        Ok(PreparedTransaction {
            call,
            hostname,
            pool: pool.clone(),
        })
    }

    /// Submits a prepared transaction to the relayer and waits for confirmation
    pub async fn submit(&self, prepared: PreparedTransaction) -> Result<TxHash, RelayerError> {
        let pool = &prepared.pool;
        let hostname = prepared.hostname;
        let call = prepared.call;
        let resp = self.submit_withdraw(pool, &hostname, call).await?;
        info!("Relayer job submitted: {}", resp.id);
        self.await_withdraw(hostname, resp).await
    }

    async fn estimate_gas_cost_wei(
        &self,
        provider: &dyn EthRpcClient,
        tx: TxData,
    ) -> Result<u128, RelayerError> {
        let gas_limit = provider
            .estimate_gas(tx.to, tx.data, None)
            .await
            .map_err(|e| RelayerError::GasEstimation(e.to_string()))?;

        let gas_price = provider
            .get_gas_price()
            .await
            .map_err(|e| RelayerError::GasEstimation(e.to_string()))?;

        let gas_cost_wei = gas_limit as u128 * gas_price;
        Ok(gas_cost_wei)
    }

    /// Submit a withdrawal call to the relayer and return its jobID
    async fn submit_withdraw(
        &self,
        pool: &Pool,
        hostname: &String,
        call: Tornado::withdrawCall,
    ) -> Result<WithdrawResponse, RelayerError> {
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

        let resp: WithdrawResponse = self.http.post_json(&url, &withdraw_payload).await?.json()?;
        Ok(resp)
    }

    /// Awaits a withdrawal job to be confirmed
    async fn await_withdraw(
        &self,
        hostname: String,
        resp: WithdrawResponse,
    ) -> Result<TxHash, RelayerError> {
        let job_url = format!("https://{hostname}/v1/jobs/{}", resp.id);
        let start = std::time::Instant::now();
        loop {
            if start.elapsed() > JOB_TIMEOUT {
                return Err(RelayerError::JobTimeout {
                    timeout_secs: JOB_TIMEOUT.as_secs(),
                });
            }

            common::sleep(JOB_POLL_INTERVAL).await;

            let job: JobStatusResponse = self.http.get(&job_url).await?.json()?;
            match job.status.as_str() {
                "CONFIRMED" => {
                    let tx_hash = job.tx_hash.unwrap_or_default();
                    info!("Withdrawal confirmed: {}", tx_hash);
                    return Ok(tx_hash);
                }
                "FAILED" => {
                    let reason = job.failed_reason.unwrap_or_else(|| "unknown".to_string());
                    warn!("Relayer job failed: {}", reason);
                    return Err(RelayerError::JobFailed { reason });
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
