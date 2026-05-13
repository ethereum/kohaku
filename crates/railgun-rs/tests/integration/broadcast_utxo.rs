use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{U256, fixed_bytes},
    providers::{Provider, ProviderBuilder},
};
use eip_1193_provider::alloy::ProviderExt;
use railgun_rs::{
    RailgunProvider,
    caip::AssetId,
    chain_config::ChainConfig,
    circuit::native::{Groth16Prover, RemoteArtifactLoader},
    crypto::keys::{MasterPublicKey, ViewingPublicKey},
    railgun::{
        RailgunSigner,
        address::RailgunAddress,
        chain::ChainId,
        indexer::{ChainedSyncer, NoteSyncer, RpcSyncer, SubsquidSyncer},
        transaction::TransactionBuilder,
    },
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;
use userop_kit::{
    ENTRY_POINT_08, ENTRY_POINT_08_DOMAIN,
    bundler::{BundlerProvider, pimlico::PimlicoBundler},
};

use crate::{alto::AltoBuilder, anvil::AnvilBuilder};

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
        // .log()
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
        // .log()
        .spawn()
        .await;

    info!("Setting up railgun");
    let prover = Arc::new(Groth16Prover::new(RemoteArtifactLoader::new(
        "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/",
    )));
    let rpc_syncer = RpcSyncer::new(chain.clone(), provider.clone().into_eip1193())
        .with_batch_size(10)
        .erased();
    let subsquid_syncer = SubsquidSyncer::new(&chain.subsquid_endpoint)
        .with_latest_block(fork_block)
        .erased();

    let syncer = ChainedSyncer::new(vec![subsquid_syncer, rpc_syncer]).erased();
    let mut railgun = RailgunProvider::new(
        chain.clone(),
        provider.clone().into_eip1193(),
        syncer,
        prover,
    );
    railgun.sync().await.unwrap();

    info!("Setting up accounts");
    let account_1 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), chain.id);
    let account_2 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), chain.id);
    railgun.register(account_1.clone());
    railgun.register(account_2.clone());

    info!("Setting up broadcaster");
    let bundler = PimlicoBundler::new(
        "http://localhost:3000".parse().unwrap(),
        chain.id,
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
    let broadcast_signer = alloy::signers::local::PrivateKeySigner::from_str(
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
        .prepare_broadcast(
            tx,
            broadcast_signer.address(),
            &bundler,
            account_1.clone(),
            RailgunAddress::new(
                RAILGUN_PAYMASTER_RECEIVER_MPK,
                RAILGUN_PAYMASTER_RECEIVER_VPK,
                ChainId::evm(chain.id),
            ),
            chain.wrapped_base_token,
            &mut rand::rng(),
        )
        .await
        .unwrap();

    let signed = prepared
        .signed(&broadcast_signer, &ENTRY_POINT_08_DOMAIN)
        .await
        .unwrap();
    info!("Prepared broadcast transaction: {:?}", prepared);
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
        .unshield(account_1.clone(), broadcast_signer.address(), weth, 5_000)
        .unwrap();

    let prepared = railgun
        .prepare_broadcast(
            tx,
            broadcast_signer.address(),
            &bundler,
            account_1.clone(),
            RailgunAddress::new(
                RAILGUN_PAYMASTER_RECEIVER_MPK,
                RAILGUN_PAYMASTER_RECEIVER_VPK,
                ChainId::evm(chain.id),
            ),
            chain.wrapped_base_token,
            &mut rand::rng(),
        )
        .await
        .unwrap();

    let signed = prepared
        .signed(&broadcast_signer, &ENTRY_POINT_08_DOMAIN)
        .await
        .unwrap();
    info!("Prepared broadcast transaction: {:?}", prepared);
    let hash = bundler.send_user_operation(&signed).await.unwrap();
    let receipt = bundler.wait_for_receipt(hash).await.unwrap();
    assert!(
        receipt.success,
        "Broadcast transaction failed: {:?}",
        receipt
    );
}
