use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, FixedBytes, U256, address, keccak256},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol_types::{SolCall, SolValue},
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
    assert_eq!(
        &native_unshield_tx.tx_data.data[..4],
        RelayAdapt::relayCall::SELECTOR
    );
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

    let nullifiers_2d: Vec<Vec<FixedBytes<32>>> = relay_call
        ._transactions
        .iter()
        .map(|t| t.nullifiers.clone())
        .collect();
    let local_encoded = (
        nullifiers_2d.clone(),
        U256::from(relay_call._transactions.len()),
        relay_call._actionData.clone(),
    )
        .abi_encode();
    let local_from_decoded = FixedBytes::<32>::from(keccak256(&local_encoded));
    let local_packed = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            relay_call._actionData.clone(),
        )
            .abi_encode_packed(),
    ));
    let mut random32 = [0u8; 32];
    random32[..31].copy_from_slice(relay_call._actionData.random.as_slice());
    let local_bytes32_random = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                FixedBytes::<32>::from(random32),
                relay_call._actionData.requireSuccess,
                relay_call._actionData.minGasLimit,
                relay_call._actionData.calls.clone(),
            ),
        )
            .abi_encode(),
    ));
    let local_min_gas_u64 = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                relay_call._actionData.random,
                relay_call._actionData.requireSuccess,
                u64::try_from(relay_call._actionData.minGasLimit).unwrap_or_default(),
                relay_call._actionData.calls.clone(),
            ),
        )
            .abi_encode(),
    ));
    let calls_alt_order: Vec<(Address, U256, alloy::primitives::Bytes)> = relay_call
        ._actionData
        .calls
        .iter()
        .map(|c| (c.to, c.value, c.data.clone()))
        .collect();
    let local_calls_value_before_data = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                relay_call._actionData.random,
                relay_call._actionData.requireSuccess,
                relay_call._actionData.minGasLimit,
                calls_alt_order.clone(),
            ),
        )
            .abi_encode(),
    ));
    let local_action_order_random_min_bool = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                relay_call._actionData.random,
                relay_call._actionData.minGasLimit,
                relay_call._actionData.requireSuccess,
                relay_call._actionData.calls.clone(),
            ),
        )
            .abi_encode(),
    ));
    let local_action_order_bool_random_min = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                relay_call._actionData.requireSuccess,
                relay_call._actionData.random,
                relay_call._actionData.minGasLimit,
                relay_call._actionData.calls.clone(),
            ),
        )
            .abi_encode(),
    ));
    let non_empty_nullifiers: Vec<Vec<FixedBytes<32>>> = nullifiers_2d
        .iter()
        .filter(|row| !row.is_empty())
        .cloned()
        .collect();
    let local_non_empty_rows_len = FixedBytes::<32>::from(keccak256(
        (
            non_empty_nullifiers.clone(),
            U256::from(non_empty_nullifiers.len()),
            relay_call._actionData.clone(),
        )
            .abi_encode(),
    ));
    let flat_nullifiers: Vec<FixedBytes<32>> = nullifiers_2d.iter().flatten().cloned().collect();
    let local_flat_nullifiers = FixedBytes::<32>::from(keccak256(
        (
            flat_nullifiers.clone(),
            U256::from(relay_call._transactions.len()),
            relay_call._actionData.clone(),
        )
            .abi_encode(),
    ));
    let local_count_total_nullifiers = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(flat_nullifiers.len()),
            relay_call._actionData.clone(),
        )
            .abi_encode(),
    ));
    let mut calls_reversed = relay_call._actionData.calls.clone();
    calls_reversed.reverse();
    let local_calls_reversed = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                relay_call._actionData.random,
                relay_call._actionData.requireSuccess,
                relay_call._actionData.minGasLimit,
                calls_reversed,
            ),
        )
            .abi_encode(),
    ));
    let mut random32_left = [0u8; 32];
    random32_left[1..].copy_from_slice(relay_call._actionData.random.as_slice());
    let local_bytes32_random_left_shift = FixedBytes::<32>::from(keccak256(
        (
            nullifiers_2d.clone(),
            U256::from(relay_call._transactions.len()),
            (
                FixedBytes::<32>::from(random32_left),
                relay_call._actionData.requireSuccess,
                relay_call._actionData.minGasLimit,
                relay_call._actionData.calls.clone(),
            ),
        )
            .abi_encode(),
    ));

    for (i, tx) in relay_call._transactions.iter().enumerate() {
        let local_adapt = tx.boundParams.adaptParams;
        if local_adapt != onchain_adapt_params {
            eprintln!(
                "Adapt params mismatch at tx[{i}]: local={:?}, onchain={:?}",
                local_adapt, onchain_adapt_params
            );
            eprintln!(
                "ActionData: random={:?} requireSuccess={} minGasLimit={:?} calls={}",
                relay_call._actionData.random,
                relay_call._actionData.requireSuccess,
                relay_call._actionData.minGasLimit,
                relay_call._actionData.calls.len()
            );
            for (call_i, call) in relay_call._actionData.calls.iter().enumerate() {
                eprintln!(
                    "  call[{call_i}]: to={:?} value={:?} data=0x{}",
                    call.to,
                    call.value,
                    hex::encode(&call.data)
                );
            }
            eprintln!("Transactions len: {}", relay_call._transactions.len());
            eprintln!("Nullifiers2D: {:?}", nullifiers_2d);
            eprintln!("Local hash (from decoded relay call): {:?}", local_from_decoded);
            eprintln!("Candidate hash (abi.encodePacked): {:?}", local_packed);
            eprintln!(
                "Candidate hash (bytes32 random in ActionData): {:?}",
                local_bytes32_random
            );
            eprintln!(
                "Candidate hash (u64 minGasLimit in ActionData): {:?}",
                local_min_gas_u64
            );
            eprintln!(
                "Candidate hash (Call tuple address,uint256,bytes): {:?}",
                local_calls_value_before_data
            );
            eprintln!(
                "Candidate hash (ActionData order random,minGas,bool,calls): {:?}",
                local_action_order_random_min_bool
            );
            eprintln!(
                "Candidate hash (ActionData order bool,random,minGas,calls): {:?}",
                local_action_order_bool_random_min
            );
            eprintln!(
                "Candidate hash (non-empty rows + count=rows.len): {:?}",
                local_non_empty_rows_len
            );
            eprintln!(
                "Candidate hash (flat nullifiers bytes32[]): {:?}",
                local_flat_nullifiers
            );
            eprintln!(
                "Candidate hash (count=total nullifiers): {:?}",
                local_count_total_nullifiers
            );
            eprintln!(
                "Candidate hash (calls reversed): {:?}",
                local_calls_reversed
            );
            eprintln!(
                "Candidate hash (bytes32 random left-shifted): {:?}",
                local_bytes32_random_left_shift
            );
            eprintln!("ABI-encoded adapt params input: 0x{}", hex::encode(&local_encoded));
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
