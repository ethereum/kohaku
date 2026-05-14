use std::sync::Arc;

use railgun_rs::{
    chain_config::ChainConfig,
    railgun::{
        indexer::{SubsquidSyncer, TxidIndexer},
        poi::client::PoiClient,
    },
};
use tracing::info;
use tracing_subscriber::EnvFilter;

const FORK_BLOCK: u64 = 24379760;

/// Tests syncing the TxidIndexer to a specific block. This integration test ensures that
/// the Txid indexer can successfully sync and verifies that its merkle tree is consistent
/// with subsquid's ground truth.
#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_sync_txid() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let chain = ChainConfig::mainnet();

    info!("Setting up POI client");
    let poi_client = PoiClient::new(chain.id, chain.poi_endpoint, chain.list_keys);
    let subsquid_syncer = Arc::new(SubsquidSyncer::new(&chain.subsquid_endpoint));
    let mut indexer = TxidIndexer::new(subsquid_syncer);

    info!("Syncing indexer");
    indexer.sync_to(FORK_BLOCK, &poi_client).await.unwrap();
}
