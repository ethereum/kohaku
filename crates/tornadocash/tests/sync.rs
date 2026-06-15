use std::sync::Arc;

use alloy::{providers::ProviderBuilder, signers::local::PrivateKeySigner};
use kohaku_db::memory::MemoryDatabase;
use tornadocash::{
    indexer::{chained::ChainedSyncer, remote::RemoteSyncer, rpc::RpcSyncer},
    provider::{pool::Pool, pool_provider::PoolProvider},
};
use tracing::info;

#[tokio::test]
#[ignore]
async fn test_sync() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let pool = Pool::SEPOLIA_ETHER_01;
    let fork_url = std::env::var("RPC_URL_SEPOLIA").expect("RPC_URL_SEPOLIA must be set");

    let signer: PrivateKeySigner =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".parse()?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect(&fork_url)
        .await?;
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone()).with_batch_size(10_000));
    let syncer = Arc::new(
        ChainedSyncer::new().then( RemoteSyncer::new("https://raw.githubusercontent.com/Robert-MacWha/privacy-protocols/refs/heads/sync-state/tornadocash-sync"))
        .then_arc(rpc_syncer.clone()));

    let db = Arc::new(MemoryDatabase::new());
    let mut pool_provider =
        PoolProvider::new(db, pool, syncer.clone(), rpc_syncer.clone()).await?;
    info!("Syncing pool provider");
    pool_provider.sync().await?;

    Ok(())
}
