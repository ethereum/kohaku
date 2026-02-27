use std::sync::Arc;

use alloy::{network::Ethereum, providers::ProviderBuilder};
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

    let cache_json = reqwest::get("https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/cache/tornadocash-classic/cache_sepolia_eth_1.json")
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let cache_syncer = Arc::new(CacheSyncer::from_str(&cache_json).unwrap());

    let rpc_url = "http://localhost:8545";
    let provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .connect(&rpc_url)
            .await
            .unwrap(),
    );

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
