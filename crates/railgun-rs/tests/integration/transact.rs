use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, address},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol_types::SolCall,
};
use eth_rpc::eth_call_sol;
use railgun_rs::{
    abis::erc20::ERC20,
    caip::AssetId,
    chain_config::{ChainConfig, MAINNET_CONFIG},
    circuit::native::{Groth16Prover, RemoteArtifactLoader},
    railgun::{RailgunProvider, Signer, indexer::RpcSyncer, transaction::TransactionBuilder},
    abis::railgun::RelayAdapt,
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;

const USDC_ADDRESS: Address = address!("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const USDC: AssetId = AssetId::Erc20(USDC_ADDRESS);
const WETH: AssetId = AssetId::Erc20(MAINNET_CONFIG.wrapped_base_token);
const CHAIN: ChainConfig = MAINNET_CONFIG;

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
async fn test_transact() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    info!("Setting up prover");
    let prover = Arc::new(Groth16Prover::new(RemoteArtifactLoader::new(
        "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/",
    )));

    info!("Setting up alloy provider");
    let signer = PrivateKeySigner::from_str(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    .unwrap();

    let provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .wallet(signer)
            .connect("http://localhost:8545")
            .await
            .unwrap(),
    );

    let usdc_contract = ERC20::new(USDC_ADDRESS, provider.clone());

    info!("Setting up railgun");
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone(), CHAIN).with_batch_size(10));
    let provider_state = std::fs::read("./tests/fixtures/provider_state.json").unwrap();
    let railgun_state = serde_json::from_slice(&provider_state).unwrap();
    let mut railgun = RailgunProvider::new(CHAIN, provider.clone(), rpc_syncer, prover);
    railgun.set_state(railgun_state).unwrap();

    info!("Setting up accounts");
    let account_1 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    let account_2 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    railgun.register(account_1.clone());
    railgun.register(account_2.clone());

    // Test Shielding
    info!("Testing shielding");
    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), USDC, 1_000_000)
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
    let balance_1 = railgun.balance(account_1.address());
    let balance_2 = railgun.balance(account_2.address());

    assert_eq!(balance_1.get(&USDC), Some(&997_500));
    assert_eq!(balance_1.get(&WETH), Some(&99_750));
    assert_eq!(balance_2.get(&USDC), None);
    assert_eq!(balance_2.get(&WETH), None);

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

    // Test Native Unshielding (WETH notes -> ETH via RelayAdapt)
    info!("Testing native unshielding");
    let native_receiver = address!("0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199");
    let native_unshield_value: u128 = 10_000;
    let pre_native_balance_eoa = provider.get_balance(native_receiver).await.unwrap();
    let pre_weth_balance = railgun.balance(account_1.address()).get(&WETH).copied();

    let tx = TransactionBuilder::new().set_unshield_native(
        account_1.clone(),
        native_receiver,
        native_unshield_value,
    );
    let native_unshield_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    // Native unshield must execute through RelayAdapt.relay(...)
    assert_eq!(native_unshield_tx.tx_data.to, CHAIN.relay_adapt_contract);
    assert_eq!(
        native_unshield_tx.tx_data.data[..4],
        RelayAdapt::relayCall::SELECTOR
    );

    // Debug parity check: offchain adapt params in boundParams must exactly match
    // onchain RelayAdapt.getAdaptParams(_transactions, _actionData).
    let relay_call = RelayAdapt::relayCall::abi_decode(&native_unshield_tx.tx_data.data).unwrap();
    let onchain_adapt_params: alloy::primitives::FixedBytes<32> = eth_call_sol(
        provider.as_ref(),
        CHAIN.relay_adapt_contract,
        RelayAdapt::getAdaptParamsCall {
            _transactions: relay_call._transactions.clone(),
            _actionData: relay_call._actionData.clone(),
        },
    )
    .await
    .unwrap();
    for (i, tx) in relay_call._transactions.iter().enumerate() {
        let local_adapt = tx.boundParams.adaptParams;
        if local_adapt != onchain_adapt_params {
            eprintln!(
                "Adapt params mismatch at tx[{i}]: local={:?}, onchain={:?}",
                local_adapt, onchain_adapt_params
            );
        }
        assert_eq!(local_adapt, onchain_adapt_params);
    }

    provider
        .send_transaction(native_unshield_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    railgun.sync().await.unwrap();
    let post_weth_balance = railgun.balance(account_1.address()).get(&WETH).copied();
    let post_native_balance_eoa = provider.get_balance(native_receiver).await.unwrap();

    // Wrapped base-token notes are spent by the unshield amount.
    assert_eq!(
        pre_weth_balance.unwrap() - post_weth_balance.unwrap(),
        native_unshield_value
    );
    // Base token arrives to the native receiver.
    assert!(post_native_balance_eoa > pre_native_balance_eoa);
}
