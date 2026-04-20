use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, address},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
};
use railgun_rs::{
    RailgunProvider,
    caip::AssetId,
    chain_config::{ChainConfig, SEPOLIA_CONFIG},
    circuit::native::{Groth16Prover, RemoteArtifactLoader},
    railgun::{Signer, indexer::RpcSyncer},
};
use rand::random;
use tracing::info;
use tracing_subscriber::EnvFilter;

const USDC_ADDRESS: Address = address!("0x1c7d4b196cb0c7b01d743fbc6116a902379c7238");
const USDC: AssetId = AssetId::Erc20(USDC_ADDRESS);
const CHAIN: ChainConfig = SEPOLIA_CONFIG;

#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_snapshot() {
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
    let signer_key = std::env::var("DEV_KEY").expect("DEV_KEY must be set");
    let signer = PrivateKeySigner::from_str(&signer_key).unwrap();
    let provider = Arc::new(
        ProviderBuilder::new()
            .network::<Ethereum>()
            .wallet(signer)
            .connect("http://localhost:8545")
            .await
            .unwrap(),
    );

    info!("Setting up railgun");
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone(), CHAIN).with_batch_size(100000));
    let mut railgun = RailgunProvider::new(CHAIN, provider.clone(), rpc_syncer, prover);

    info!("Setting up accounts");
    let account_1 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    let account_2 = railgun_rs::railgun::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);

    info!("Syncing to latest block");
    railgun.sync().await.unwrap();
    railgun.register(account_1.clone());
    railgun.register(account_2.clone());

    // Shielding
    info!("Shield");
    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), USDC, 10_000_000)
        .build(&mut rand::rng())
        .unwrap();

    for tx in shield_tx {
        info!("Sending shield transaction to relay");
        info!("Tx: {:?}", tx);
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

    assert_eq!(balance_1.get(&USDC), Some(&9_975_000));
    assert_eq!(balance_2.get(&USDC), None);

    // Fee Payment Transfer
    info!("Fee Transfer");
    let tx = railgun.transact().transfer(
        account_1.clone(),
        account_2.address(),
        USDC,
        5_000_000,
        "test transfer",
    );
    let transfer_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    info!("Sending transfer transaction to relay");
    info!("Tx: {:?}", transfer_tx.tx_data);
    info!("Receiver address: {:?}", account_2.address());
    info!(
        "Receiver master public key: {:?}",
        account_2.address().master_key()
    );
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

    assert_eq!(balance_1.get(&USDC), Some(&4_975_000));
    assert_eq!(balance_2.get(&USDC), Some(&5_000_000));
}
