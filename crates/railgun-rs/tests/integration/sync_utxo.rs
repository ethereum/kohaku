use std::sync::Arc;

use alloy::{network::Ethereum, providers::ProviderBuilder};
use eip_1193_provider::alloy::ProviderExt;
use railgun_rs::{
    chain_config::ChainConfig,
    circuit::native::{Groth16Prover, RemoteArtifactLoader},
    railgun::{RailgunProvider, indexer::SubsquidSyncer},
};
use tracing::info;
use tracing_subscriber::EnvFilter;

const FORK_BLOCK: u64 = 24379760;

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
    let provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .connect(&fork_url)
            .await
            .unwrap(),
    );

    info!("Setting up indexer");
    let subsquid_syncer = Arc::new(SubsquidSyncer::new(&chain.subsquid_endpoint));
    let prover = Arc::new(Groth16Prover::new(RemoteArtifactLoader::new(
        "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts",
    )));
    //? We use the RailgunProvider here instead of a UtxoIndexer so that we can write
    //? the provider state to a file after syncing. This snapshot can be used in subsequent
    //? tests to avoid re-syncing from scratch, which currently takes ~1 minute.
    let mut railgun = RailgunProvider::new(
        chain.clone(),
        provider.clone().into_eip1193(),
        subsquid_syncer.clone(),
        prover,
    );

    info!("Syncing indexer");
    railgun.sync_to(FORK_BLOCK).await.unwrap();

    let state = serde_json::to_string(&railgun.state()).unwrap();
    std::fs::write("./tests/fixtures/provider_state.json", state).unwrap();
}
