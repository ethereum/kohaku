use std::sync::Arc;

use alloy::{network::Ethereum, providers::ProviderBuilder};
use tc_rs::{
    SEPOLIA_ETHER_1,
    indexer::{ChainedSyncer, Indexer, RemoteSyncer, RpcSyncer},
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

    let remote_syncer = Arc::new(RemoteSyncer::new(
        "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocols/refs/heads/sync-state/tornadocash-sync/",
    ));
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
        Arc::new(ChainedSyncer::new(vec![remote_syncer, rpc_syncer.clone()]));
    let mut indexer = Indexer::new(syncer.clone(), rpc_syncer.clone(), SEPOLIA_ETHER_1);

    info!("Syncing indexer...");
    indexer.sync().await.unwrap();

    info!("Verifying computed root against on-chain root...");
    assert!(
        indexer.verify().await.is_ok(),
        "computed root should be known on-chain"
    );
}
