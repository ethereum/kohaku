use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, address},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
};
use railgun_rs::{
    abis::erc20::ERC20,
    caip::AssetId,
    chain_config::{ChainConfig, MAINNET_CONFIG},
    circuit::native::Groth16Prover,
    railgun::{
        RailgunProvider, indexer::RpcSyncer, signer::Signer, transaction::TransactionBuilder,
    },
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;

const USDC_ADDRESS: Address = address!("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const USDC: AssetId = AssetId::Erc20(USDC_ADDRESS);
const CHAIN: ChainConfig = MAINNET_CONFIG;

#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_transact() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    info!("Setting up prover");
    let prover = Arc::new(Groth16Prover::new_native("../../artifacts/railgun"));

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
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone(), CHAIN).with_batch_size(10));
    let provider_state = std::fs::read("./tests/fixtures/provider_state.json").unwrap();
    let railgun_state = serde_json::from_slice(&provider_state).unwrap();
    let mut railgun = RailgunProvider::new(CHAIN, provider.clone(), rpc_syncer, prover);
    railgun.set_state(railgun_state).unwrap();

    info!("Setting up accounts");
    let account_1 =
        railgun_rs::railgun::signer::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    let account_2 =
        railgun_rs::railgun::signer::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    railgun.register(account_1.clone());
    railgun.register(account_2.clone());

    // Test Shielding
    info!("Testing shielding");
    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), USDC, 1_000_000)
        .build(&mut rand::rng())
        .unwrap();

    provider
        .send_transaction(shield_tx.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    railgun.sync().await.unwrap();
    let balance_1 = railgun.balance(account_1.address());
    let balance_2 = railgun.balance(account_2.address());

    assert_eq!(balance_1.get(&USDC), Some(&997_500));
    assert_eq!(balance_2.get(&USDC), None);

    // Test Transfer
    info!("Testing transfer");
    let tx = TransactionBuilder::new().transfer(
        account_1.clone(),
        account_2.address(),
        USDC,
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
    let balance_1 = railgun.balance(account_1.address());
    let balance_2 = railgun.balance(account_2.address());

    assert_eq!(balance_1.get(&USDC), Some(&992500));
    assert_eq!(balance_2.get(&USDC), Some(&5000));

    // Test Unshielding
    info!("Testing unshielding");
    let tx = TransactionBuilder::new().set_unshield(
        account_1.clone(),
        address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"),
        USDC,
        1_000,
    );
    let unshield_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    provider
        .send_transaction(unshield_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    railgun.sync().await.unwrap();
    let balance_1 = railgun.balance(account_1.address());
    let balance_2 = railgun.balance(account_2.address());
    let balance_eoa = usdc_contract
        .balanceOf(address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"))
        .call()
        .await
        .unwrap();

    assert_eq!(balance_1.get(&USDC), Some(&991500));
    assert_eq!(balance_2.get(&USDC), Some(&5000));
    assert_eq!(balance_eoa, 998);
}
