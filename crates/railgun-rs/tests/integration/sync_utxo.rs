use std::sync::Arc;

use alloy::{network::Ethereum, providers::ProviderBuilder};
use railgun_rs::{
    chain_config::{ChainConfig, MAINNET_CONFIG},
    circuit::native::{Groth16Prover, RemoteArtifactLoader},
    railgun::{RailgunProvider, indexer::SubsquidSyncer},
};
use tracing::info;
use tracing_subscriber::EnvFilter;

const CHAIN: ChainConfig = MAINNET_CONFIG;
const FORK_BLOCK: u64 = 24379760;

/// Integration test for syncing the UTXO indexer's state from subsquid. Also
/// caches the provider state after syncing, which is used in subsequent tests.
#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_sync_utxo() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    info!("Setting up chain client");
    let fork_url = std::env::var("RPC_URL_MAINNET").expect("Fork URL Must be set");
    let provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .connect(&fork_url)
            .await
            .unwrap(),
    );

    info!("Setting up indexer");
    let subsquid_syncer = Arc::new(SubsquidSyncer::new(CHAIN.subsquid_endpoint));
    let prover = Arc::new(Groth16Prover::new(RemoteArtifactLoader::new(
        "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts",
    )));
    let mut railgun =
        RailgunProvider::new(CHAIN, provider.clone(), subsquid_syncer.clone(), prover);

    info!("Syncing indexer");
    railgun.sync_to(FORK_BLOCK).await.unwrap();

    let state = serde_json::to_string(&railgun.state()).unwrap();
    std::fs::write("./tests/fixtures/provider_state.json", state).unwrap();
}
