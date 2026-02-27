use std::{path::Path, sync::Arc};

use alloy::{
    network::Ethereum,
    providers::{Provider, ProviderBuilder},
};
use tc_rs::{
    Pool,
    indexer::{CacheSyncer, ChainedSyncer, Indexer, RpcSyncer},
};
use tracing::info;

#[tokio::test]
#[ignore]
async fn test_sync_indexer() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let cache_path = Path::new("./tests/fixtures/cache_sepolia_eth_1.json");
    let cache_json = std::fs::read_to_string(cache_path).unwrap();
    let cache_syncer = Arc::new(CacheSyncer::from_str(&cache_json).unwrap());

    let rpc_url = "http://localhost:8545";
    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .connect(&rpc_url)
        .await
        .unwrap()
        .erased();

    let rpc_syncer = Arc::new(RpcSyncer::new(provider).with_batch_size(10000));
    let syncer: Arc<ChainedSyncer> =
        Arc::new(ChainedSyncer::new(vec![cache_syncer, rpc_syncer.clone()]));
    let mut indexer = Indexer::new(syncer.clone(), rpc_syncer.clone(), Pool::sepolia_ether_1());

    info!("Syncing indexer...");
    indexer.sync().await.unwrap();

    info!("Verifying computed root against on-chain root...");
    assert!(
        indexer.verify().await.is_ok(),
        "computed root should be known on-chain"
    );
}
