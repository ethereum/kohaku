use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{U256, address},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol,
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

use crate::utils::AnvilBuilder;

sol! {
    #[sol(rpc)]
    // WETH interface
    contract WETH {
        function approve(address guy, uint256 wad) external returns (bool);
        function balanceOf(address input) external view returns (uint256);
        function deposit() external payable;
    }
}

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

    let chain = ChainConfig::sepolia();
    let weth = AssetId::Erc20(chain.wrapped_base_token);

    info!("Setting up alloy provider");
    let signer = PrivateKeySigner::from_str(
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

    let weth_contract = WETH::new(chain.wrapped_base_token, provider.clone());

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

    info!("Setting up accounts");
    let account_1 =
        railgun::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    let account_2 =
        railgun::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    railgun.register(account_1.clone()).await.unwrap();
    railgun.register(account_2.clone()).await.unwrap();

    // Wrap some native tokens into WETH
    weth_contract
        .deposit()
        .value(U256::from(2_000_000))
        .send()
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    // Test Shielding
    info!("Testing shielding");
    weth_contract
        .approve(chain.railgun_smart_wallet, U256::from(2_000_000))
        .send()
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), weth, 1_000_000)
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

    assert_eq!(balance_1.get(&weth), Some(&997_500));
    assert_eq!(balance_2.get(&weth), None);

    // Test shield native
    info!("Testing shielding native");
    let shield_tx = railgun
        .shield()
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

    assert_eq!(balance_1.get(&weth), Some(&1_097_250));
    assert_eq!(balance_2.get(&weth), None);

    // Test Transfer
    info!("Testing transfer");
    let tx = TransactionBuilder::new().transfer(
        account_1.clone(),
        account_2.address(),
        weth,
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

    assert_eq!(balance_1.get(&weth), Some(&1_092_250));
    assert_eq!(balance_2.get(&weth), Some(&5_000));

    // Test Unshielding
    info!("Testing unshielding");
    let tx = TransactionBuilder::new()
        .unshield(
            account_1.clone(),
            address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"),
            weth,
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
    let balance_eoa = weth_contract
        .balanceOf(address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"))
        .call()
        .await
        .unwrap();

    assert_eq!(balance_1.get(&weth), Some(&1_091_250));
    assert_eq!(balance_2.get(&weth), Some(&5_000));
    assert_eq!(balance_eoa, 998);
}
