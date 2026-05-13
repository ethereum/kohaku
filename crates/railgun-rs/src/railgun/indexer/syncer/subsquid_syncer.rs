//! Subsquid syncer for fetching commitments, nullifiers, and operations from a
//! Subsquid graphql endpoint. Railgun maintains an official indexer for each
//! supported chain.

use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;
use tracing::{info, warn};

use crate::railgun::indexer::{
    NoteSyncer, TransactionSyncer,
    syncer::{self, subsquid_types::*, syncer::SyncerError},
};

pub struct SubsquidSyncer {
    client: reqwest::Client,
    url: String,
    batch_size: u64,
    max_retries: usize,
    retry_delay: web_time::Duration,

    /// Override for latest block, used for testing to sync to a specific block.
    latest_block_override: Option<u64>,
}

#[derive(Debug, Error)]
pub enum SubsquidSyncerError {
    #[error("Serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Request failed with status {0}: {1}")]
    Request(reqwest::StatusCode, String),
    #[error("GraphQL error: {0}")]
    GraphQL(String),
}

const COMMITMENTS_QUERY: &str = include_str!("./subsquid_graphql/commitments.graphql");
const NULLIFIERS_QUERY: &str = include_str!("./subsquid_graphql/nullifiers.graphql");
const OPERATIONS_QUERY: &str = include_str!("./subsquid_graphql/operations.graphql");
const BLOCK_NUMBER_QUERY: &str = include_str!("./subsquid_graphql/block_number.graphql");

impl SubsquidSyncer {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            url: url.into(),
            batch_size: 20000,
            max_retries: 3,
            retry_delay: web_time::Duration::from_secs(1),
            latest_block_override: None,
        }
    }

    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }

    pub fn with_retry_policy(
        mut self,
        max_retries: usize,
        retry_delay: web_time::Duration,
    ) -> Self {
        self.max_retries = max_retries;
        self.retry_delay = retry_delay;
        self
    }

    pub fn with_latest_block(mut self, latest_block: u64) -> Self {
        self.latest_block_override = Some(latest_block);
        self
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl NoteSyncer for SubsquidSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        Ok(self.latest_block().await?)
    }

    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<syncer::SyncEvent>, SyncerError> {
        if from_block > to_block {
            return Ok(vec![]);
        }
        info!("Starting Subsquid note sync {}-{}", from_block, to_block);

        let mut events = Vec::new();

        let mut commitments = self.commitments(from_block, to_block).await?;
        events.append(&mut commitments);

        let mut nullifiers = self.nullifiers(from_block, to_block).await?;
        events.append(&mut nullifiers);
        Ok(events)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl TransactionSyncer for SubsquidSyncer {
    async fn latest_block(&self) -> Result<u64, SyncerError> {
        Ok(self.latest_block().await?)
    }

    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<syncer::Operation>, SyncerError> {
        if from_block > to_block {
            return Ok(vec![]);
        }
        info!(
            "Starting Subsquid operation sync {}-{}",
            from_block, to_block
        );

        let operations = self.operations(from_block, to_block).await?;
        Ok(operations)
    }
}

impl SubsquidSyncer {
    async fn latest_block(&self) -> Result<u64, SubsquidSyncerError> {
        if let Some(override_block) = self.latest_block_override {
            return Ok(override_block);
        }

        let data: BlockNumberResponsese = self.post_retry(BLOCK_NUMBER_QUERY, ()).await?;
        let latest_block = data
            .transactions
            .first()
            .map(|tx| tx.block_number)
            .unwrap_or(0);
        Ok(latest_block)
    }

    async fn commitments(
        &self,
        from: u64,
        to: u64,
    ) -> Result<Vec<syncer::SyncEvent>, SubsquidSyncerError> {
        self.fetch_paged(
            "commitments",
            COMMITMENTS_QUERY,
            from,
            to,
            |data: CommitmentsResponse| {
                let last = data.commitments.last();
                let id = last.map(|c| c.id.clone()).unwrap_or_default();
                let block = last.map(|c| c.block_number).unwrap_or(0);
                let items = data
                    .commitments
                    .into_iter()
                    .map(syncer::SyncEvent::from)
                    .collect();
                (items, id, block)
            },
        )
        .await
    }

    async fn nullifiers(
        &self,
        from: u64,
        to: u64,
    ) -> Result<Vec<syncer::SyncEvent>, SubsquidSyncerError> {
        self.fetch_paged(
            "nullifiers",
            NULLIFIERS_QUERY,
            from,
            to,
            |data: NullifiersResponse| {
                let last = data.nullifiers.last();
                let id = last.map(|c| c.id.clone()).unwrap_or_default();
                let block = last.map(|c| c.block_number).unwrap_or(0);
                let items = data
                    .nullifiers
                    .into_iter()
                    .map(syncer::SyncEvent::from)
                    .collect();
                (items, id, block)
            },
        )
        .await
    }

    async fn operations(
        &self,
        from: u64,
        to: u64,
    ) -> Result<Vec<syncer::Operation>, SubsquidSyncerError> {
        self.fetch_paged(
            "operations",
            OPERATIONS_QUERY,
            from,
            to,
            |data: OperationsResponse| {
                let last = data.operations.last();
                let id = last.map(|c| c.id.clone()).unwrap_or_default();
                let block = last.map(|c| c.block_number).unwrap_or(0);
                let items = data
                    .operations
                    .into_iter()
                    .map(syncer::Operation::from)
                    .collect();
                (items, id, block)
            },
        )
        .await
    }

    async fn fetch_paged<R, T, F>(
        &self,
        name: &str,
        query: &'static str,
        from: u64,
        to: u64,
        map_fn: F,
    ) -> Result<Vec<T>, SubsquidSyncerError>
    where
        R: DeserializeOwned,
        F: Fn(R) -> (Vec<T>, String, u64), // Returns (items, last_id, last_block)
    {
        let mut id_gt = String::new();
        let mut all_items = Vec::new();

        loop {
            let vars = QueryVars {
                id_gt: id_gt.clone(),
                block_number_gte: from,
                block_number_lte: to,
                limit: self.batch_size,
            };

            let data: R = self.post_retry(query, vars).await?;
            let (items, last_id, last_block) = map_fn(data);

            if items.is_empty() {
                break;
            }

            id_gt = last_id;
            all_items.extend(items);

            info!("{}/{} ({} {})", last_block, to, all_items.len(), name);
        }

        Ok(all_items)
    }

    async fn post_retry<V: Serialize, R: DeserializeOwned>(
        &self,
        query: &'static str,
        variables: V,
    ) -> Result<R, SubsquidSyncerError> {
        let body = GraphqlRequest { query, variables };

        let mut attempt = 0;
        loop {
            match self.post_graphql(&body).await {
                Ok(data) => return Ok(data),
                Err(e) => {
                    attempt += 1;
                    if attempt > self.max_retries {
                        return Err(e);
                    }

                    warn!(
                        "GraphQL request failed (attempt {}/{}): {}",
                        attempt, self.max_retries, e
                    );
                    common::sleep(self.retry_delay).await;
                }
            }
        }
    }

    async fn post_graphql<V: Serialize, R: DeserializeOwned>(
        &self,
        body: &GraphqlRequest<V>,
    ) -> Result<R, SubsquidSyncerError> {
        let resp = self.client.post(&self.url).json(&body).send().await?;
        if !resp.status().is_success() {
            return Err(SubsquidSyncerError::Request(
                resp.status(),
                resp.text().await.unwrap_or_default(),
            ));
        }

        let value: serde_json::Value = resp.json().await?;
        // info!("Deserializing: {}", &value);
        let graphql_resp: GraphqlResponse<R> = serde_json::from_value(value)?;
        if let Some(errors) = graphql_resp.errors {
            return Err(SubsquidSyncerError::GraphQL(
                errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }

        let Some(data) = graphql_resp.data else {
            return Err(SubsquidSyncerError::GraphQL(
                "No data in response".to_string(),
            ));
        };

        Ok(data)
    }
}

impl From<SubsquidSyncerError> for SyncerError {
    fn from(e: SubsquidSyncerError) -> Self {
        SyncerError::Syncer(Box::new(e))
    }
}
