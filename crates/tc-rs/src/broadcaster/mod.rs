mod indexer;
mod provider;
mod rpc_syncer;
mod syncer;

pub use indexer::{BroadcasterConfig, BroadcasterIndexer, Relayer};
pub use provider::{BroadcastProvider, PreparedBroadcast};
pub use rpc_syncer::RpcRelayerSyncer;
pub use syncer::{RelayerRecord, RelayerSyncer};

use crate::{TornadoProviderError, indexer::SyncerError};

#[derive(Debug, thiserror::Error)]
pub enum BroadcasterError {
    #[error("No relayer available")]
    NoRelayerAvailable,
    #[error("HTTP: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Relayer job failed: {reason}")]
    JobFailed { reason: String },
    #[error("Relayer job timed out after {timeout_secs}s")]
    JobTimeout { timeout_secs: u64 },
    #[error("Provider: {0}")]
    Provider(#[from] TornadoProviderError),
    #[error("Gas estimation: {0}")]
    GasEstimation(String),
    #[error("Syncer: {0}")]
    Syncer(#[from] SyncerError),
    #[error("Aggregator call failed: {0}")]
    Aggregator(String),
}
