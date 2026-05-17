use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::U256,
    providers::{Provider, ProviderBuilder},
};
use railgun::{
    account::signer::RailgunSigner,
    builder::RailgunBuilder,
    caip::AssetId,
    chain_config::ChainConfig,
    indexer::syncer::{ChainedSyncer, RpcSyncer, SubsquidSyncer},
    transact::TransactionBuilder,
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;
use userop_kit::{
    bundler::{Bundler, pimlico::PimlicoBundler},
    entry_point::ENTRY_POINT_08,
};

use crate::utils::{AltoBuilder, AnvilBuilder};

/// Tests a full broadcast flow, transfering and unshielding a UTXO note
/// via a 4337-style broadcast.
///
/// This integration test ensures that the 4337 broadcasting operates correctly.
/// This mainly includes the gas estimation, 7702-authorization, and on-chain
/// paymaster execution.
///
/// This integration test DOES NOT verify any TXID or POI functionality.
#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_broadcast_utxo() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let chain = ChainConfig::sepolia();
    let weth = AssetId::Erc20(chain.wrapped_base_token);

    let signer = alloy::signers::local::PrivateKeySigner::from_str(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    .unwrap();

    let fork_block = 10822990;
    let fork_url = std::env::var("RPC_URL_SEPOLIA").expect("RPC_URL_SEPOLIA must be set");

    info!("Setting up alloy provider");
    let _anvil = AnvilBuilder::new()
        .fork_url(&fork_url)
        .fork_block(fork_block)
        .spawn()
        .await;

    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .wallet(signer)
        .connect("http://localhost:8545")
        .await
        .unwrap()
        .erased();

    let alto_executor_pk = "0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5";
    let alto_utility_pk = "0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6";
    crate::utils::set_pk_balances(
        &provider,
        &[alto_executor_pk, alto_utility_pk],
        U256::from(1000000000000000000000u128),
    )
    .await;

    let _alto = AltoBuilder::new()
        .entrypoint(ENTRY_POINT_08.to_string())
        .executor_private_key(alto_executor_pk)
        .utility_private_key(alto_utility_pk)
        .rpc_url("http://localhost:8545")
        .spawn()
        .await;

    info!("Setting up railgun");
    let syncer = Arc::new(
        ChainedSyncer::new()
            .then(SubsquidSyncer::new(&chain.subsquid_endpoint).with_latest_block(fork_block))
            .then(RpcSyncer::new(chain.clone(), provider.clone()).with_batch_size(1000)),
    );
    let mut railgun = RailgunBuilder::new(chain.clone(), provider.clone())
        .with_utxo_syncer(syncer)
        .build()
        .await
        .unwrap();

    let bundler = Arc::new(PimlicoBundler::new(
        "http://localhost:3000".parse().unwrap(),
    ));

    railgun.sync().await.unwrap();

    info!("Setting up accounts");
    let account_1 =
        railgun::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    let account_2 =
        railgun::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    railgun.register(account_1.clone()).await.unwrap();
    railgun.register(account_2.clone()).await.unwrap();

    // Test Shielding
    info!("Testing shielding");
    let shield_tx = railgun
        .shield()
        .shield_native(account_1.address(), 1_000_000_000_000_000_000)
        .build(&mut rand::rng())
        .unwrap();

    for tx in shield_tx {
        info!("Sending shielding transaction");
        provider
            .send_transaction(tx.into())
            .await
            .unwrap()
            .get_receipt()
            .await
            .unwrap();
    }

    railgun.sync().await.unwrap();
    let balance_1 = railgun.balance(account_1.address()).await;
    let balance_2 = railgun.balance(account_2.address()).await;

    assert_eq!(balance_1.get(&weth), Some(&997_500_000_000_000_000));
    assert_eq!(balance_2.get(&weth), None);

    // Test Transfer
    let delegator = alloy::signers::local::PrivateKeySigner::from_str(
        "0xd01165bc18d3f0d0b2114a42930164f729ae8310f447b4dd2e96124c02bbe151",
    )
    .unwrap();

    info!("Testing transfer");
    let tx = TransactionBuilder::new().transfer(
        account_1.clone(),
        account_2.address(),
        weth,
        5_000,
        "test transfer",
    );

    let prepared = railgun
        .prepare_userop(
            tx,
            bundler.as_ref(),
            delegator.address(),
            account_1.clone(),
            chain.wrapped_base_token,
            &mut rand::rng(),
        )
        .await
        .unwrap();

    info!("Prepared broadcast transaction: {:?}", prepared);
    let signed = prepared.sign(&delegator).await.unwrap();
    let hash = bundler.send_user_operation(&signed).await.unwrap();
    let receipt = bundler.wait_for_receipt(hash).await.unwrap();
    assert!(
        receipt.success,
        "Broadcast transaction failed: {:?}",
        receipt
    );

    // Sync to update balances after transfer
    railgun.sync().await.unwrap();

    info!("Testing unshielding");
    let tx = TransactionBuilder::new()
        .unshield(account_1.clone(), delegator.address(), weth, 5_000)
        .unwrap();

    let prepared = railgun
        .prepare_userop(
            tx,
            bundler.as_ref(),
            delegator.address(),
            account_1.clone(),
            chain.wrapped_base_token,
            &mut rand::rng(),
        )
        .await
        .unwrap();

    info!("Prepared broadcast transaction: {:?}", prepared);
    let signed = prepared.sign(&delegator).await.unwrap();
    let hash = bundler.send_user_operation(&signed).await.unwrap();
    let receipt = bundler.wait_for_receipt(hash).await.unwrap();
    assert!(
        receipt.success,
        "Broadcast transaction failed: {:?}",
        receipt
    );
}
