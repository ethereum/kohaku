use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, address},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol,
};
use railgun_rs::{
    account::signer::RailgunSigner,
    builder::RailgunBuilder,
    caip::AssetId,
    chain_config::ChainConfig,
    indexer::syncer::{
        chained_syncer::ChainedSyncer, rpc_syncer::RpcSyncer, subsquid_syncer::SubsquidSyncer,
    },
    transaction::TransactionBuilder,
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;

sol! {
    #[sol(rpc)]
    // ERC20 interface
    contract ERC20 {
        function balanceOf(address account) external view returns (uint256);
    }
}

const FORK_BLOCK: u64 = 24379760;
const USDC_ADDRESS: Address = address!("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

/// Tests a full transact flow, including shielding, transferring, and unshielding.
///
/// This integration test ensures that the entire transact flow works correctly using
/// the public RailgunProvider interface. Includes internal syncing, tx building, UTXO
/// management, and UTXO proof generation.
///
/// This integration test DOES NOT verify any TXID or POI functionality.
#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_transact_utxo() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let chain = ChainConfig::mainnet();
    let weth = AssetId::Erc20(chain.wrapped_base_token);
    let usdc = AssetId::Erc20(USDC_ADDRESS);

    info!("Setting up alloy provider");
    let signer = PrivateKeySigner::from_str(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    .unwrap();

    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .wallet(signer)
        .connect("http://localhost:8545")
        .await
        .unwrap()
        .erased();

    let usdc_contract = ERC20::new(USDC_ADDRESS, provider.clone());

    info!("Setting up railgun");
    let syncer = Arc::new(
        ChainedSyncer::new()
            .then(SubsquidSyncer::new(&chain.subsquid_endpoint).with_latest_block(FORK_BLOCK))
            .then(RpcSyncer::new(chain.clone(), provider.clone()).with_batch_size(10)),
    );
    let mut railgun = RailgunBuilder::new(chain.clone(), provider.clone())
        .with_utxo_syncer(syncer)
        .build()
        .await
        .unwrap();
    railgun.sync().await.unwrap();

    info!("Setting up accounts");
    let account_1 =
        railgun_rs::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    let account_2 =
        railgun_rs::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    railgun.register(account_1.clone()).await.unwrap();
    railgun.register(account_2.clone()).await.unwrap();

    // Test Shielding
    info!("Testing shielding");
    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), usdc, 1_000_000)
        .shield_native(account_1.address(), 100_000)
        .build(&mut rand::rng())
        .unwrap();

    for tx in shield_tx {
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

    assert_eq!(balance_1.get(&usdc), Some(&997_500));
    assert_eq!(balance_1.get(&weth), Some(&99_750));
    assert_eq!(balance_2.get(&usdc), None);
    assert_eq!(balance_2.get(&weth), None);

    // Test Transfer
    info!("Testing transfer");
    let tx = TransactionBuilder::new().transfer(
        account_1.clone(),
        account_2.address(),
        usdc,
        5_000,
        "test transfer",
    );
    let transfer_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    provider
        .send_transaction(transfer_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    railgun.sync().await.unwrap();
    let balance_1 = railgun.balance(account_1.address()).await;
    let balance_2 = railgun.balance(account_2.address()).await;

    assert_eq!(balance_1.get(&usdc), Some(&992500));
    assert_eq!(balance_2.get(&usdc), Some(&5000));

    // Test Unshielding
    info!("Testing unshielding");
    let tx = TransactionBuilder::new()
        .unshield(
            account_1.clone(),
            address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"),
            usdc,
            1_000,
        )
        .unwrap();
    let unshield_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    provider
        .send_transaction(unshield_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    railgun.sync().await.unwrap();
    let balance_1 = railgun.balance(account_1.address()).await;
    let balance_2 = railgun.balance(account_2.address()).await;
    let balance_eoa = usdc_contract
        .balanceOf(address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"))
        .call()
        .await
        .unwrap();

    assert_eq!(balance_1.get(&usdc), Some(&991500));
    assert_eq!(balance_2.get(&usdc), Some(&5000));
    assert_eq!(balance_eoa, 998);
}
