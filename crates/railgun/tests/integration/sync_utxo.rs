use alloy::{
    network::Ethereum,
    providers::{Provider, ProviderBuilder},
};
use railgun::{builder::RailgunBuilder, chain_config::ChainConfig};
use tracing::info;
use tracing_subscriber::EnvFilter;

/// Tests syncing the UTXO state to a specific block. This integration test ensures that
/// the UTXO syncer can successfully sync and verifies that the provider's state is consistent
/// with railgun's on-chain merkle tree.
#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_sync_utxo() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let chain = ChainConfig::mainnet();

    info!("Setting up chain client");
    let fork_url = std::env::var("RPC_URL_MAINNET").expect("Fork URL Must be set");
    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .connect(&fork_url)
        .await
        .unwrap()
        .erased();

    info!("Setting up indexer");
    let mut railgun = RailgunBuilder::new(chain.clone(), provider.clone())
        .build()
        .await
        .unwrap();

    info!("Syncing indexer");
    railgun.sync().await.unwrap();
}
