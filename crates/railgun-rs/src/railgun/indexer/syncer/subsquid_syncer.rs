use std::array::TryFromSliceError;

use alloy::primitives::{Bytes, FixedBytes, U256, ruint::ParseError};
use futures::{Stream, StreamExt, stream};
use graphql_client::{GraphQLQuery, Response};
use reqwest::Client;
use thiserror::Error;
use tracing::{info, warn};

#[cfg(feature = "poi")]
use crate::railgun::indexer::syncer::{Operation, TransactionSyncer};
use crate::{
    abis::railgun::{
        CommitmentCiphertext, CommitmentPreimage, RailgunSmartWallet, ShieldCiphertext, TokenData,
        TokenType,
    },
    railgun::indexer::syncer::{
        compat::BoxedSyncStream,
        decimal_bigint,
        syncer::{LegacyCommitment, NoteSyncer, SyncEvent},
    },
    sleep::sleep,
};

pub type BigInt = decimal_bigint::DecimalU256;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "graphql/schemas/railgun.graphql",
    query_path = "graphql/queries/commitments.graphql",
    response_derives = "Debug, Clone"
)]
struct CommitmentsQuery {}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "graphql/schemas/railgun.graphql",
    query_path = "graphql/queries/nullifiers.graphql",
    response_derives = "Debug, Clone"
)]
struct NullifiersQuery {}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "graphql/schemas/railgun.graphql",
    query_path = "graphql/queries/operations.graphql",
    response_derives = "Debug, Clone"
)]
struct OperationsQuery {}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "graphql/schemas/railgun.graphql",
    query_path = "graphql/queries/block_number.graphql",
    response_derives = "Debug, Clone"
)]
struct BlockNumberQuery {}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "graphql/schemas/railgun.graphql",
    query_path = "graphql/queries/root.graphql",
    response_derives = "Debug, Clone"
)]
struct SeenRootQuery {}

pub struct SubsquidSyncer {
    client: Client,
    endpoint: String,
    batch_size: u32,
}

#[derive(Debug, Error)]
pub enum SubsquidError {
    #[error("HTTP request error: {0}")]
    HttpRequestError(#[from] reqwest::Error),
    #[error("Graphql Errors: {0:?}")]
    GraphqlErrors(Vec<graphql_client::Error>),
    #[error("Server error {0}: {1}")]
    ServerError(reqwest::StatusCode, String),
    #[error("Missing data in response")]
    MissingData,
    #[error("TryFromSlice error: {0}")]
    TryFromSlice(#[from] TryFromSliceError),
    #[error("ParseInt Error: {0}")]
    ParseInt(#[from] ParseError),
    #[error("Invalid data: {0}")]
    InvalidData(String),
}

const MAX_RETRIES: u32 = 3;
const RETRY_DELAY: web_time::Duration = web_time::Duration::from_secs(1);

impl SubsquidSyncer {
    pub fn new(endpoint: &str) -> Self {
        let client = Client::new();

        SubsquidSyncer {
            client,
            endpoint: endpoint.to_string(),
            batch_size: 20000,
        }
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl NoteSyncer for SubsquidSyncer {
    async fn latest_block(&self) -> Result<u64, Box<dyn std::error::Error>> {
        let request_body = BlockNumberQuery::build_query(block_number_query::Variables {});

        let data: block_number_query::ResponseData =
            self.post_graphql("latest_block", request_body).await?;

        let block_number = data
            .transactions
            .into_iter()
            .next()
            .map(|t| t.block_number.0.saturating_to::<u64>())
            .unwrap_or(0);

        Ok(block_number)
    }

    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<BoxedSyncStream<'_>, Box<dyn std::error::Error>> {
        info!(
            "Starting sync from block {} to block {}",
            from_block, to_block
        );

        let commitment_stream = self.commitment_stream(from_block, to_block);
        let nullified_stream = self.nullified_stream(from_block, to_block);

        let stream = commitment_stream.chain(nullified_stream);

        Ok(Box::pin(stream))
    }
}

#[cfg(feature = "poi")]
#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl TransactionSyncer for SubsquidSyncer {
    async fn latest_block(&self) -> Result<u64, Box<dyn std::error::Error>> {
        let request_body = BlockNumberQuery::build_query(block_number_query::Variables {});

        let data: block_number_query::ResponseData =
            self.post_graphql("latest_block", request_body).await?;

        let block_number = data
            .transactions
            .into_iter()
            .next()
            .map(|t| t.block_number.0.saturating_to::<u64>())
            .unwrap_or(0);

        Ok(block_number)
    }

    // TODO: Refactor me to use streams like the other sync methods
    async fn sync(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<(Operation, u64)>, Box<dyn std::error::Error>> {
        info!(
            "Fetching operations from block {} to block {}",
            from_block, to_block
        );

        let mut all_operations = Vec::new();
        let mut last_id = String::new();

        loop {
            let (ops, next_id) = self
                .fetch_operations(from_block, to_block, &last_id)
                .await?;
            if ops.is_empty() {
                break;
            }
            last_id = next_id;
            all_operations.extend(ops);
        }

        Ok(all_operations)
    }
}

impl SubsquidSyncer {
    #[cfg(not(feature = "wasm"))]
    fn commitment_stream(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + Send + '_ {
        self.commitment_stream_inner(from_block, to_block)
    }

    #[cfg(feature = "wasm")]
    fn commitment_stream(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + '_ {
        self.commitment_stream_inner(from_block, to_block)
    }

    fn commitment_stream_inner(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + '_ {
        stream::unfold(String::new(), move |last_id| async move {
            info!("Fetching commitments");

            let batch = match self
                .fetch_commitment_events(from_block, to_block, &last_id)
                .await
            {
                Ok(batch) => batch,
                Err(e) => {
                    warn!("Failed to fetch commitments: {}", e);
                    return None;
                }
            };

            if batch.0.is_empty() && batch.1.is_empty() && batch.2.is_empty() {
                info!("Synced commitments up to block {}", to_block);
                return None;
            }

            info!(
                "Fetched batch of commitments: {} shields, {} transacts, {} legacy",
                batch.0.len(),
                batch.1.len(),
                batch.2.len()
            );
            let events: Vec<SyncEvent> = batch
                .0
                .into_iter()
                .map(|(s, b)| SyncEvent::Shield(s, b))
                .chain(batch.1.into_iter().map(|(t, b)| SyncEvent::Transact(t, b)))
                .chain(batch.2.into_iter().map(|(l, b)| SyncEvent::Legacy(l, b)))
                .collect();

            Some((stream::iter(events), batch.3))
        })
        .flatten()
    }

    #[cfg(not(feature = "wasm"))]
    fn nullified_stream(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + Send + '_ {
        self.nullified_stream_inner(from_block, to_block)
    }

    #[cfg(feature = "wasm")]
    fn nullified_stream(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + '_ {
        self.nullified_stream_inner(from_block, to_block)
    }

    fn nullified_stream_inner(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> impl Stream<Item = SyncEvent> + '_ {
        stream::unfold(String::new(), move |last_id| async move {
            info!("Fetching nullifieds");

            let batch = match self
                .fetch_nullified_events(from_block, to_block, &last_id)
                .await
            {
                Ok(batch) => batch,
                Err(e) => {
                    warn!("Failed to fetch nullifieds: {}", e);
                    return None;
                }
            };

            if batch.0.is_empty() {
                info!("Synced nullifieds up to block {}", to_block);
                return None;
            }

            info!("Fetched batch of nullifieds: {}", batch.0.len());
            let events: Vec<SyncEvent> = batch
                .0
                .into_iter()
                .map(|(n, b)| SyncEvent::Nullified(n, b))
                .collect();

            Some((stream::iter(events), batch.1))
        })
        .flatten()
    }

    pub async fn fetch_commitment_events(
        &self,
        from_block: u64,
        to_block: u64,
        after_id: &str,
    ) -> Result<
        (
            Vec<(RailgunSmartWallet::Shield, u64)>,
            Vec<(RailgunSmartWallet::Transact, u64)>,
            Vec<(LegacyCommitment, u64)>,
            String,
        ),
        SubsquidError,
    > {
        let request_body = CommitmentsQuery::build_query(commitments_query::Variables {
            id_gt: Some(after_id.to_string()),
            block_number_gte: Some(U256::from(from_block).into()),
            block_number_lte: Some(U256::from(to_block).into()),
            limit: Some(self.batch_size as i64),
        });

        let data: commitments_query::ResponseData =
            self.post_graphql("commitments", request_body).await?;

        let commitments = data.commitments;
        let last_id = commitments
            .last()
            .map(|c| c.id.clone())
            .unwrap_or("".to_string());

        let mut shield_events = Vec::new();
        let mut transact_events = Vec::new();
        let mut legacy_events = Vec::new();

        for c in commitments.into_iter() {
            match &c.on {
                commitments_query::CommitmentsQueryCommitmentsOn::ShieldCommitment(shield) => {
                    let shield = parse_shield(&c, shield)?;
                    shield_events.push((shield, c.block_number.0.saturating_to::<u64>()));
                }
                commitments_query::CommitmentsQueryCommitmentsOn::TransactCommitment(transact) => {
                    let transact = parse_transact(&c, transact)?;
                    transact_events.push((transact, c.block_number.0.saturating_to::<u64>()))
                }
                _ => legacy_events.push((
                    LegacyCommitment {
                        hash: c.hash.0,
                        tree_number: c.tree_number as u32,
                        leaf_index: c.tree_position as u32,
                    },
                    c.block_number.0.saturating_to::<u64>(),
                )),
            }
        }

        Ok((shield_events, transact_events, legacy_events, last_id))
    }

    async fn fetch_nullified_events(
        &self,
        from_block: u64,
        to_block: u64,
        after_id: &str,
    ) -> Result<(Vec<(RailgunSmartWallet::Nullified, u64)>, String), SubsquidError> {
        let request_body = NullifiersQuery::build_query(nullifiers_query::Variables {
            id_gt: Some(after_id.to_string()),
            block_number_gte: Some(U256::from(from_block).into()),
            block_number_lte: Some(U256::from(to_block).into()),
            limit: Some(self.batch_size as i64),
        });

        let data: nullifiers_query::ResponseData =
            self.post_graphql("nullifiers", request_body).await?;

        let nullifieds = data.nullifiers;
        let last_id = nullifieds
            .last()
            .map(|n| n.id.clone())
            .unwrap_or("".to_string());

        let mut nullified_events = Vec::new();

        for n in nullifieds.into_iter() {
            let bytes = n.nullifier.as_ref();

            if bytes.len() > 32 {
                return Err(SubsquidError::InvalidData(format!(
                    "Invalid nullifier length {}: {}",
                    bytes.len(),
                    n.nullifier
                )));
            }

            let nullified = RailgunSmartWallet::Nullified {
                treeNumber: n.tree_number as u16,
                nullifier: vec![FixedBytes::<32>::left_padding_from(bytes)],
            };

            nullified_events.push((nullified, n.block_number.0.saturating_to::<u64>()));
        }

        Ok((nullified_events, last_id))
    }

    #[cfg(feature = "poi")]
    async fn fetch_operations(
        &self,
        from_block: u64,
        to_block: u64,
        after_id: &str,
    ) -> Result<(Vec<(Operation, u64)>, String), SubsquidError> {
        let request_body = OperationsQuery::build_query(operations_query::Variables {
            id_gt: Some(after_id.to_string()),
            block_number_gte: Some(U256::from(from_block).into()),
            block_number_lte: Some(U256::from(to_block).into()),
            limit: Some(self.batch_size as i64),
        });

        let data: operations_query::ResponseData =
            self.post_graphql("operations", request_body).await?;

        let operations_data = data.transactions;
        let last_id = operations_data
            .last()
            .map(|op| op.id.clone())
            .unwrap_or("".to_string());

        let mut operations = Vec::new();
        for op in operations_data.into_iter() {
            let block_number = op.block_number.0.saturating_to::<u64>();
            let operation = Operation {
                nullifiers: op
                    .nullifiers
                    .into_iter()
                    .map(|n| U256::from_be_slice(n.as_ref()))
                    .collect(),
                commitment_hashes: op
                    .commitments
                    .into_iter()
                    .map(|h| U256::from_be_slice(h.as_ref()))
                    .collect(),
                bound_params_hash: U256::from_be_slice(op.bound_params_hash.as_ref()),
                utxo_tree_in: op.utxo_tree_in.0.saturating_to(),
                utxo_tree_out: op.utxo_tree_out.0.saturating_to(),
                utxo_out_start_index: op.utxo_batch_start_position_out.0.saturating_to(),
            };
            operations.push((operation, block_number));
        }

        Ok((operations, last_id))
    }

    async fn post_graphql<V, R>(&self, op_name: &str, body: V) -> Result<R, SubsquidError>
    where
        V: serde::Serialize,
        R: serde::de::DeserializeOwned,
    {
        let json_body = serde_json::to_vec(&body).map_err(|e| {
            SubsquidError::InvalidData(format!("Failed to serialize request: {}", e))
        })?;

        //? Retry request to handle transient errors
        let mut attempts = 0;
        loop {
            let result: Result<Response<R>, SubsquidError> = async {
                let response = self
                    .client
                    .post(&self.endpoint)
                    .header("Content-Type", "application/json")
                    .body(json_body.clone())
                    .send()
                    .await?;

                if !response.status().is_success() {
                    return Err(SubsquidError::ServerError(
                        response.status(),
                        response.text().await.unwrap_or_default(),
                    ));
                }

                Ok(response.json().await?)
            }
            .await;

            match result {
                Ok(res) => {
                    if let Some(errs) = res.errors {
                        return Err(SubsquidError::GraphqlErrors(errs));
                    }
                    match res.data {
                        Some(data) => return Ok(data),
                        None => return Err(SubsquidError::MissingData),
                    }
                }
                Err(e) => {
                    attempts += 1;
                    warn!("Failed to fetch {}: {}", op_name, e);
                    if attempts >= MAX_RETRIES {
                        return Err(e.into());
                    }
                    sleep(RETRY_DELAY).await;
                }
            }
        }
    }
}

fn parse_shield(
    c: &commitments_query::CommitmentsQueryCommitments,
    shield: &commitments_query::CommitmentsQueryCommitmentsOnShieldCommitment,
) -> Result<RailgunSmartWallet::Shield, SubsquidError> {
    if shield.encrypted_bundle.len() != 3 {
        return Err(SubsquidError::InvalidData(format!(
            "Invalid encrypted bundle length: {}",
            shield.encrypted_bundle.len()
        )));
    }

    let mut packed = [FixedBytes::<32>::ZERO; 3];
    for (i, element) in shield.encrypted_bundle.iter().enumerate() {
        packed[i] = element.as_ref().try_into().map_err(|e| {
            SubsquidError::InvalidData(format!("Invalid encrypted bundle element {}: {}", i, e))
        })?;
    }

    let token_type = match shield.preimage.token.token_type {
        commitments_query::TokenType::ERC20 => TokenType::ERC20,
        commitments_query::TokenType::ERC721 => TokenType::ERC721,
        commitments_query::TokenType::ERC1155 => TokenType::ERC1155,
        commitments_query::TokenType::Other(_) => {
            warn!("Unknown token type: {:?}", shield.preimage.token.token_type);
            TokenType::__Invalid
        }
    };

    let shield =
        RailgunSmartWallet::Shield {
            treeNumber: U256::from(c.tree_number),
            startPosition: U256::from(c.tree_position),
            commitments: vec![CommitmentPreimage {
                npk: shield
                    .preimage
                    .npk
                    .as_ref()
                    .try_into()
                    .map_err(|e| SubsquidError::InvalidData(format!("Invalid npk: {}", e)))?,
                token: TokenData {
                    tokenType: token_type,
                    tokenAddress: shield
                        .preimage
                        .token
                        .token_address
                        .as_ref()
                        .try_into()
                        .map_err(|e| {
                            SubsquidError::InvalidData(format!("Invalid token address: {}", e))
                        })?,
                    tokenSubID: shield.preimage.token.token_sub_id.parse::<U256>().map_err(
                        |e| SubsquidError::InvalidData(format!("Invalid token sub ID: {}", e)),
                    )?,
                },
                value: shield.preimage.value.0.saturating_to(),
            }],
            shieldCiphertext: vec![ShieldCiphertext {
                shieldKey: shield.shield_key.as_ref().try_into().map_err(|e| {
                    SubsquidError::InvalidData(format!("Invalid shield key: {}", e))
                })?,
                encryptedBundle: packed,
            }],
            fees: vec![],
        };

    Ok(shield)
}

fn parse_transact(
    c: &commitments_query::CommitmentsQueryCommitments,
    transact: &commitments_query::CommitmentsQueryCommitmentsOnTransactCommitment,
) -> Result<RailgunSmartWallet::Transact, SubsquidError> {
    let raw = transact.ciphertext.ciphertext.clone();
    let mut packed = [FixedBytes::<32>::ZERO; 4];
    let iv: [u8; 16] = raw
        .iv
        .as_ref()
        .try_into()
        .map_err(|e| SubsquidError::InvalidData(format!("Invalid IV: {}", e)))?;
    let tag: [u8; 16] = raw
        .tag
        .as_ref()
        .try_into()
        .map_err(|e| SubsquidError::InvalidData(format!("Invalid tag: {}", e)))?;
    packed[0][..16].copy_from_slice(&iv);
    packed[0][16..].copy_from_slice(&tag);

    if raw.data.len() != 3 {
        return Err(SubsquidError::InvalidData(format!(
            "Invalid ciphertext data length: {}",
            raw.data.len()
        )));
    }

    for (i, element) in raw.data.into_iter().enumerate() {
        packed[i + 1] = element.as_ref().try_into().map_err(|e| {
            SubsquidError::InvalidData(format!("Invalid ciphertext data element {}: {}", i, e))
        })?;
    }

    let transact = RailgunSmartWallet::Transact {
        treeNumber: U256::from(c.tree_number),
        startPosition: U256::from(c.tree_position),
        hash: vec![c.hash.0.into()],
        ciphertext: vec![CommitmentCiphertext {
            ciphertext: packed,
            annotationData: transact.ciphertext.annotation_data.clone(),
            memo: transact.ciphertext.memo.clone(),
            blindedSenderViewingKey: transact
                .ciphertext
                .blinded_sender_viewing_key
                .as_ref()
                .try_into()
                .map_err(|e| {
                    SubsquidError::InvalidData(format!("Invalid blinded viewing key: {}", e))
                })?,
            blindedReceiverViewingKey: transact
                .ciphertext
                .blinded_receiver_viewing_key
                .as_ref()
                .try_into()
                .map_err(|e| {
                    SubsquidError::InvalidData(format!("Invalid blinded viewing key: {}", e))
                })?,
        }],
    };
    Ok(transact)
}
