use std::sync::Arc;

use railgun_rs::{
    chain_config::{ChainConfig, MAINNET_CONFIG},
    railgun::{
        indexer::{SubsquidSyncer, TxidIndexer},
        poi::PoiClient,
    },
};
use tracing::info;
use tracing_subscriber::EnvFilter;

const CHAIN: ChainConfig = MAINNET_CONFIG;
const FORK_BLOCK: u64 = 24379760;

#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_sync_txid() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    info!("Setting up POI client");
    let poi_client = PoiClient::new(CHAIN.poi_endpoint, CHAIN.id).await.unwrap();

    let subsquid_syncer = Arc::new(SubsquidSyncer::new(CHAIN.subsquid_endpoint));
    let mut indexer = TxidIndexer::new(subsquid_syncer, poi_client);

    info!("Syncing indexer");
    indexer.sync_to(FORK_BLOCK).await.unwrap();
}
