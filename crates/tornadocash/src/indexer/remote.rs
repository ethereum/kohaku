use alloy::primitives::{Address, B256, U256};
use anyhow::Context;
use reqwest::{Client, Url};
use serde::Deserialize;
use thiserror::Error;
use tracing::info;

use crate::{
    abis::tornado::Tornado::{Deposit, Withdrawal},
    indexer::syncer::{SyncEvent, Syncer, SyncerError},
    provider::pool::Pool,
};

/// A syncer that reads from a remote database of cached data.
///
/// The remote database is expected to point to a directory of cache files.
/// The cache files should be named in the format
/// `{chain_id}_{asset}_{amount}_{deposits/nullifiers}.ndjson` and should contain
/// newline-delimited JSON objects representing deposits and nullifiers for the
/// given pool.
pub struct RemoteSyncer {
    client: Client,
    base_url: String,
}

#[derive(Deserialize)]
struct RemoteDeposit {
    pub block_number: u64,
    pub commitment: B256,
    pub leaf_index: u32,
    pub timestamp: U256,
}

#[derive(Deserialize)]
struct RemoteWithdrawal {
    pub block_number: u64,
    pub nullifier: B256,
    pub to: Address,
    pub fee: U256,
}

#[derive(Debug, Error)]
pub enum RemoteSyncerError {
    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("Serde error: {0}")]
    JsonError(#[from] serde_json::Error),
}

impl RemoteSyncer {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.to_string(),
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Syncer for RemoteSyncer {
    async fn latest_block(&self, pool: &Pool) -> Result<u64, SyncerError> {
        let deposits = self
            .deposits(pool)
            .await
            .context("Error fetching deposits")?;
        let withdrawals = self
            .withdrawals(pool)
            .await
            .context("Error fetching withdrawals")?;

        let latest_deposit = deposits.iter().map(|d| d.block_number).max().unwrap_or(0);
        let latest_nullifier = withdrawals
            .iter()
            .map(|n| n.block_number)
            .max()
            .unwrap_or(0);

        Ok(latest_deposit.max(latest_nullifier))
    }

    async fn sync(
        &self,
        pool: &Pool,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, SyncerError> {
        info!("Syncing from {} to {}", from_block, to_block);

        let deposits = self
            .deposits(pool)
            .await
            .context("Error fetching deposits")?;
        let withdrawals = self
            .withdrawals(pool)
            .await
            .context("Error fetching withdrawals")?;

        let deposits: Vec<Deposit> = deposits
            .into_iter()
            .filter(|d| d.block_number >= from_block && d.block_number <= to_block)
            .map(Into::into)
            .collect();
        let withdrawals: Vec<Withdrawal> = withdrawals
            .into_iter()
            .filter(|n| n.block_number >= from_block && n.block_number <= to_block)
            .map(Into::into)
            .collect();

        Ok(deposits
            .into_iter()
            .map(SyncEvent::Deposit)
            .chain(withdrawals.into_iter().map(SyncEvent::Withdrawal))
            .collect())
    }
}

impl RemoteSyncer {
    async fn deposits(&self, pool: &Pool) -> Result<Vec<RemoteDeposit>, RemoteSyncerError> {
        let resp = self
            .client
            .get(self.deposits_url(pool))
            .send()
            .await?
            .text()
            .await?;

        let deposits = resp
            .lines()
            .filter(|line| !line.is_empty())
            .map(serde_json::from_str::<RemoteDeposit>)
            .collect::<Result<_, _>>()?;
        Ok(deposits)
    }

    async fn withdrawals(&self, pool: &Pool) -> Result<Vec<RemoteWithdrawal>, RemoteSyncerError> {
        let withdrawals = self
            .client
            .get(self.withdrawals_url(pool))
            .send()
            .await?
            .text()
            .await?;

        let withdrawals = withdrawals
            .lines()
            .filter(|line| !line.is_empty())
            .map(serde_json::from_str::<RemoteWithdrawal>)
            .collect::<Result<_, _>>()?;
        Ok(withdrawals)
    }

    fn deposits_url(&self, pool: &Pool) -> Url {
        format!(
            "{}/{}_{}_{}_deposits.ndjson",
            self.base_url,
            pool.chain_id,
            pool.symbol(),
            pool.amount()
        )
        .parse()
        .unwrap()
    }

    fn withdrawals_url(&self, pool: &Pool) -> Url {
        format!(
            "{}/{}_{}_{}_nullifiers.ndjson",
            self.base_url,
            pool.chain_id,
            pool.symbol(),
            pool.amount()
        )
        .parse()
        .unwrap()
    }
}

impl From<RemoteDeposit> for Deposit {
    fn from(remote: RemoteDeposit) -> Self {
        Deposit {
            commitment: remote.commitment,
            leafIndex: remote.leaf_index,
            timestamp: remote.timestamp,
        }
    }
}

impl From<RemoteWithdrawal> for Withdrawal {
    fn from(remote: RemoteWithdrawal) -> Self {
        Withdrawal {
            nullifierHash: remote.nullifier,
            to: remote.to,
            relayer: Address::ZERO,
            fee: remote.fee,
        }
    }
}
