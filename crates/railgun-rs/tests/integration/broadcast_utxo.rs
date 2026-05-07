use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    providers::{Provider, ProviderBuilder},
};
use alloy_primitives::fixed_bytes;
use railgun_rs::{
    RailgunProvider,
    caip::AssetId,
    chain_config::{ChainConfig, SEPOLIA_CONFIG},
    circuit::native::{Groth16Prover, RemoteArtifactLoader},
    crypto::keys::{MasterPublicKey, ViewingPublicKey},
    railgun::{
        Signer,
        address::{ChainId, RailgunAddress},
        indexer::RpcSyncer,
        transaction::TransactionBuilder,
    },
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;
use userop_kit::{BundlerProvider, ENTRY_POINT_08, PimlicoBundler};

const WETH: AssetId = AssetId::Erc20(SEPOLIA_CONFIG.wrapped_base_token);
const CHAIN: ChainConfig = SEPOLIA_CONFIG;

const RAILGUN_PAYMASTER_RECEIVER_MPK: MasterPublicKey = MasterPublicKey::from_bytes_const(
    fixed_bytes!("0x19acdde26147205d58fd7768be7c011f08a147ef86e6b70968d09c81cef74b13").0,
);
const RAILGUN_PAYMASTER_RECEIVER_VPK: ViewingPublicKey = ViewingPublicKey::from_bytes_const(
    fixed_bytes!("0x63ec4d326fc49c1c71064c982fb0bcbca2ba593b44ff7e8c7e4e75b401ae1d9c").0,
);

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

    info!("Setting up alloy provider");
    let signer = alloy::signers::local::PrivateKeySigner::from_str(
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

    info!("Setting up railgun");
    let prover = Arc::new(Groth16Prover::new(RemoteArtifactLoader::new(
        "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/",
    )));

    let provider_state = std::fs::read("./tests/fixtures/provider_state.json").unwrap();
    let railgun_state = serde_json::from_slice(&provider_state).unwrap();
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone(), CHAIN).with_batch_size(100000));
    let mut railgun = RailgunProvider::new(CHAIN, provider.clone(), rpc_syncer, prover);
    railgun.set_state(railgun_state).unwrap();

    info!("Setting up accounts");
    let account_1 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    let account_2 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    railgun.register(account_1.clone());
    railgun.register(account_2.clone());

    info!("Setting up broadcaster");
    let bundler = PimlicoBundler::new(
        "http://localhost:3000".parse().unwrap(),
        CHAIN.id,
        ENTRY_POINT_08,
    );

    // Test Shielding
    info!("Testing shielding");
    let shield_tx = railgun
        .shield()
        .shield_native(account_1.address(), 1_000_000_000_000_000_000)
        .build(&mut rand::rng())
        .unwrap();

    for tx in shield_tx {
        info!("Sending shielding transaction");
        // info!(" Calldata: 0x{}", tx.data);
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

    assert_eq!(balance_1.get(&WETH), Some(&997_500_000_000_000_000));
    assert_eq!(balance_2.get(&WETH), None);

    // Test Transfer
    let broadcast_signer = alloy::signers::local::PrivateKeySigner::from_str(
        "0xd01165bc18d3f0d0b2114a42930164f729ae8310f447b4dd2e96124c02bbe151",
    )
    .unwrap();

    info!("Testing transfer");
    let tx = TransactionBuilder::new().transfer(
        account_1.clone(),
        account_2.address(),
        WETH,
        5_000,
        "test transfer",
    );

    let prepared = railgun
        .prepare_broadcast(
            tx,
            &provider,
            &broadcast_signer,
            &bundler,
            account_1.clone(),
            RailgunAddress::new(
                RAILGUN_PAYMASTER_RECEIVER_MPK,
                RAILGUN_PAYMASTER_RECEIVER_VPK,
                ChainId::EVM(CHAIN.id),
            ),
            SEPOLIA_CONFIG.wrapped_base_token,
            &mut rand::rng(),
        )
        .await
        .unwrap();
    info!("Prepared broadcast transaction: {:?}", prepared);
    let hash = bundler.send_user_operation(&prepared).await.unwrap();
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
        .unshield(account_1.clone(), broadcast_signer.address(), WETH, 5_000)
        .unwrap();

    let prepared = railgun
        .prepare_broadcast(
            tx,
            &provider,
            &broadcast_signer,
            &bundler,
            account_1.clone(),
            RailgunAddress::new(
                RAILGUN_PAYMASTER_RECEIVER_MPK,
                RAILGUN_PAYMASTER_RECEIVER_VPK,
                ChainId::EVM(CHAIN.id),
            ),
            SEPOLIA_CONFIG.wrapped_base_token,
            &mut rand::rng(),
        )
        .await
        .unwrap();

    info!("Prepared broadcast transaction: {:?}", prepared);
    let hash = bundler.send_user_operation(&prepared).await.unwrap();
    let receipt = bundler.wait_for_receipt(hash).await.unwrap();
    assert!(
        receipt.success,
        "Broadcast transaction failed: {:?}",
        receipt
    );
}
