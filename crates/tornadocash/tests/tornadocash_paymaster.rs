use std::sync::Arc;

use alloy::{
    primitives::address,
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
};
use kohaku_db::memory::MemoryDatabase;
use kohaku_test_utils::AltoBuilder;
use tornadocash::{
    indexer::{chained::ChainedSyncer, remote::RemoteSyncer, rpc::RpcSyncer},
    provider::{pool::Pool, provider::TornadoProvider},
    userop_provider::TornadoPaymasterExt,
};
use tracing::info;
use userop_kit::{
    builder::UserOperationBuilder,
    bundler::Bundler,
    entry_point::ENTRY_POINT_08,
    smart_account::simple_7702_smart_account::{Call, Simple7702SmartAccount},
};

#[tokio::test]
#[ignore = "run with `cargo test --release -- --ignored`"]
async fn test_tornadocash_paymaster() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init()
        .ok();

    let pool = Pool::SEPOLIA_ETHER_01;
    let fork_url = std::env::var("RPC_URL_SEPOLIA").expect("RPC_URL_SEPOLIA must be set");

    let signer: PrivateKeySigner =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".parse()?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_anvil_with_config(|anvil| anvil.fork(fork_url).port(8545u16).host("0.0.0.0"))
        .erased();

    let chain_id = provider.get_chain_id().await?;

    let db = Arc::new(MemoryDatabase::new());
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone()).with_batch_size(10_000));
    let syncer = Arc::new(
        ChainedSyncer::new().then( RemoteSyncer::new("https://raw.githubusercontent.com/Robert-MacWha/privacy-protocols/refs/heads/sync-state/tornadocash-sync"))
        .then_arc(rpc_syncer.clone()));

    let mut tornado_provider =
        TornadoProvider::new(provider.clone(), db, syncer.clone(), rpc_syncer.clone());
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

    info!("Withdrawing from pool with tornadocash paymaster");
    let owner: PrivateKeySigner = PrivateKeySigner::random();
    let smart_account = Simple7702SmartAccount::new(provider.clone(), owner.address(), chain_id);

    let bundler = AltoBuilder::new()
        .rpc_url("http://localhost:8545")
        .entrypoint(ENTRY_POINT_08.to_string())
        .executor_private_key("0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5")
        .utility_private_key("0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6")
        .prefund(&provider)
        .await
        .spawn()
        .await;

    let userop = UserOperationBuilder::new_with_smart_account(&smart_account)
        .await?
        .with_call(&vec![Call {
            target: address!("0x000000000000000000000000000000000000dead"),
            ..Default::default()
        }])
        .with_tornadocash_paymaster(
            &note,
            owner.address(),
            &mut tornado_provider,
            &bundler,
            &mut rand::rng(),
        )
        .await?
        .build()
        .sign(&owner)
        .await?;

    let userop_hash = bundler.send_user_operation(&userop).await?;
    let userop_receipt = bundler.wait_for_receipt(userop_hash).await?;
    info!("Userop receipt: {userop_receipt:?}");

    Ok(())
}
