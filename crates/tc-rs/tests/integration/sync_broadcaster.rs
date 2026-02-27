use std::{collections::HashMap, sync::Arc};

use alloy::{
    network::Ethereum,
    providers::{Provider, ProviderBuilder},
};
use prover::{Proof, Prover, ProverError};
use ruint::aliases::U256;
use tc_rs::{
    broadcaster::{BroadcastProvider, RpcRelayerSyncer},
    indexer::RpcSyncer,
};
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

    let mainnet_provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .connect(&mainnet_rpc_url)
        .await
        .unwrap()
        .erased();

    let sepolia_provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .connect(&sepolia_rpc_url)
        .await
        .unwrap()
        .erased();

    let rpc_syncer = Arc::new(RpcSyncer::new(sepolia_provider.clone()).with_batch_size(10000));
    let relay_syncer =
        Arc::new(RpcRelayerSyncer::new(mainnet_provider.clone()).with_batch_size(10000));

    let prover = Arc::new(MockProver);
    let mut tornado = BroadcastProvider::new(
        rpc_syncer.clone(),
        rpc_syncer.clone(),
        prover,
        relay_syncer,
        mainnet_provider.clone(),
    );

    tornado.sync_to(14_400_000).await.unwrap();
    let relayers = tornado.relayers();
    if relayers.is_empty() {
        panic!("Expected to find some relayers, but found none");
    }

    info!("Found {} healthy relayers", relayers.len());
}

struct MockProver;

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl Prover for MockProver {
    async fn prove(
        &self,
        _: &str,
        _: HashMap<String, Vec<U256>>,
    ) -> Result<(Proof, Vec<U256>), ProverError> {
        todo!()
    }
}
