use std::{collections::HashMap, sync::Arc};

use alloy::{network::Ethereum, providers::ProviderBuilder};
use prover::{Proof, Prover, ProverError};
use ruint::aliases::U256;
use tc_rs::{indexer::RpcSyncer, relayers::RelayerProvider};
use tracing::info;

#[tokio::test]
#[ignore]
async fn test_sync_broadcaster() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let mainnet_rpc_url = std::env::var("RPC_URL_MAINNET").unwrap();
    let sepolia_rpc_url = std::env::var("RPC_URL_SEPOLIA").unwrap();

    let mainnet_provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .connect(&mainnet_rpc_url)
            .await
            .unwrap(),
    );

    let sepolia_provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .connect(&sepolia_rpc_url)
            .await
            .unwrap(),
    );

    let rpc_syncer = Arc::new(RpcSyncer::new(sepolia_provider.clone()).with_batch_size(10000));

    let prover = Arc::new(MockProver);
    let mut tornado = RelayerProvider::new(
        sepolia_provider.clone(),
        rpc_syncer,
        prover,
        mainnet_provider.clone(),
    );

    // tornado.sync_to(14_400_000).await.unwrap();
    tornado.sync().await.unwrap();
    let relayers = tornado.relayers();
    if relayers.is_empty() {
        panic!("Expected to find some relayers, but found none");
    }

    info!("Found {} healthy relayers", relayers.len());
}

struct MockProver;

#[async_trait::async_trait]
impl Prover for MockProver {
    async fn prove(
        &self,
        _: &str,
        _: HashMap<String, Vec<U256>>,
    ) -> Result<(Proof, Vec<U256>), ProverError> {
        todo!()
    }
}
