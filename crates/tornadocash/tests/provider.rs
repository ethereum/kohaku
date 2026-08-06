use std::sync::Arc;

use alloy::{
    primitives::Address,
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
};
use kohaku_db::memory::MemoryDatabase;
use tornadocash::{
    indexer::rpc::RpcSyncer,
    provider::{pool::Pool, provider::TornadoProvider},
};
use tracing::info;

#[tokio::test]
#[ignore = "run with `cargo test --release -- --ignored`"]
async fn test_provider() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let pool = Pool::SEPOLIA_ETHER_01;
    let fork_block = pool.deployed_block + 10_000;
    let fork_url = std::env::var("RPC_URL_SEPOLIA").expect("RPC_URL_SEPOLIA must be set");

    let signer: PrivateKeySigner =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".parse()?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_anvil_with_config(|anvil| anvil.fork(fork_url).fork_block_number(fork_block))
        .erased();

    let syncer = Arc::new(RpcSyncer::new(provider.clone()).with_batch_size(10_000));
    let db = Arc::new(MemoryDatabase::new());
    let mut tornado_provider =
        TornadoProvider::new(provider.clone(), db, syncer.clone(), syncer.clone());
    info!("Syncing pool provider");
    tornado_provider.pool(pool).await?;
    tornado_provider.sync().await?;

    info!("Depositing into pool");
    let (deposit_call, note) = tornado_provider.deposit(pool, &mut rand::rng())?;
    info!("Deposit call: {deposit_call:?}");
    info!("Deposit note: {note:?}");

    let receipt = provider
        .send_transaction(deposit_call.into())
        .await?
        .get_receipt()
        .await?;
    info!("Deposit tx receipt: {receipt:?}");

    tornado_provider.sync().await?;

    info!("Withdrawing from pool");
    let recipient: Address = PrivateKeySigner::random().address();
    let withdraw_call = tornado_provider
        .withdraw(&note, recipient, None, None, None, &mut rand::rng())
        .await?;
    info!("Withdraw call: {withdraw_call:?}");

    let receipt = provider
        .send_transaction(withdraw_call.into())
        .await?
        .get_receipt()
        .await?;
    info!("Withdraw tx receipt: {receipt:?}");

    Ok(())
}
