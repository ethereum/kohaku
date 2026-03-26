use alloy_primitives::Address;
use request::{HttpClient, HttpError, ResponseExt};
use thiserror::Error;

use crate::{
    Pool,
    indexer::{Commitment, Nullifier, Syncer, SyncerError},
};

/// A syncer that reads from a remote database of cached data.
///
/// The remote database is expected to point to a directory of cache files.
/// The cache files should be named in the format
/// `{chain_id}_{asset}_{amount}_{deposits/nullifiers}.ndjson` and should contain
/// newline-delimited JSON objects representing deposits and nullifiers for the
/// given pool.
pub struct RemoteSyncer {
    client: HttpClient,
    base_url: String,
}

#[derive(Debug, Error)]
pub enum RemoteSyncerError {
    #[error("Unknown pool: {0}")]
    UnknownPool(Address),
    #[error("HTTP error: {0}")]
    HttpError(#[from] HttpError),
    #[error("Serde error: {0}")]
    JsonError(#[from] serde_json::Error),
}

impl RemoteSyncer {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: HttpClient::new(None),
            base_url: base_url.to_string(),
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Syncer for RemoteSyncer {
    async fn latest_block(&self, contract: Address) -> Result<u64, SyncerError> {
        let pool = Pool::from_address(contract).ok_or(RemoteSyncerError::UnknownPool(contract))?;
        let deposits = self.deposits(&pool).await?;
        let nullifiers = self.nullifiers(&pool).await?;

        let latest_deposit = deposits.iter().map(|d| d.block_number).max().unwrap_or(0);
        let latest_nullifier = nullifiers.iter().map(|n| n.block_number).max().unwrap_or(0);

        Ok(latest_deposit.max(latest_nullifier))
    }

    async fn sync_commitments(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Commitment>, SyncerError> {
        let pool = Pool::from_address(contract).ok_or(RemoteSyncerError::UnknownPool(contract))?;
        Ok(self
            .deposits(&pool)
            .await?
            .into_iter()
            .filter(|d| d.block_number >= from_block && d.block_number <= to_block)
            .collect())
    }

    async fn sync_nullifiers(
        &self,
        contract: Address,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Nullifier>, SyncerError> {
        let pool = Pool::from_address(contract).ok_or(RemoteSyncerError::UnknownPool(contract))?;
        Ok(self
            .nullifiers(&pool)
            .await?
            .into_iter()
            .filter(|n| n.block_number >= from_block && n.block_number <= to_block)
            .collect())
    }
}

impl RemoteSyncer {
    async fn deposits(&self, pool: &Pool) -> Result<Vec<Commitment>, RemoteSyncerError> {
        let deposits = self.client.get(&self.deposits_url(&pool)).await?.text()?;
        let deposits: Vec<Commitment> = deposits
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_str(line))
            .collect::<Result<_, _>>()?;
        Ok(deposits)
    }

    async fn nullifiers(&self, pool: &Pool) -> Result<Vec<Nullifier>, RemoteSyncerError> {
        let nullifiers = self.client.get(&self.nullifiers_url(&pool)).await?.text()?;
        let nullifiers: Vec<Nullifier> = nullifiers
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_str(line))
            .collect::<Result<_, _>>()?;
        Ok(nullifiers)
    }

    fn deposits_url(&self, pool: &Pool) -> String {
        format!(
            "{}/{}_{}_{}_deposits.ndjson",
            self.base_url,
            pool.chain_id,
            pool.symbol(),
            pool.amount()
        )
    }

    fn nullifiers_url(&self, pool: &Pool) -> String {
        format!(
            "{}/{}_{}_{}_nullifiers.ndjson",
            self.base_url,
            pool.chain_id,
            pool.symbol(),
            pool.amount()
        )
    }
}

impl From<RemoteSyncerError> for SyncerError {
    fn from(err: RemoteSyncerError) -> Self {
        SyncerError::Syncer(Box::new(err))
    }
}
