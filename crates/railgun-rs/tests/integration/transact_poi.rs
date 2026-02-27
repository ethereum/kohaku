use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, address},
    providers::{DynProvider, Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
};
use railgun_rs::{
    abis::erc20::ERC20,
    caip::AssetId,
    chain_config::{ChainConfig, SEPOLIA_CONFIG},
    circuit::native::Groth16Prover,
    railgun::{
        PoiProvider,
        indexer::{ChainedSyncer, RpcSyncer, SubsquidSyncer},
        poi::{ListKey, PoiClient, PoiStatus},
        signer::Signer,
        transaction::PoiTransactionBuilder,
    },
    sleep::sleep,
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
async fn test_transact_poi() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    info!("Setting up prover");
    let prover = Arc::new(Groth16Prover::new_native("../../artifacts/railgun"));

    info!("Setting up alloy provider");
    let signer_key = std::env::var("DEV_KEY").expect("DEV_KEY must be set");
    let signer = PrivateKeySigner::from_str(&signer_key).unwrap();
    let fork_url = std::env::var("RPC_URL_SEPOLIA").expect("Fork URL Must be set");
    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .wallet(signer)
        .connect(&fork_url)
        .await
        .unwrap()
        .erased();

    info!("Setting up railgun");
    let subsquid_syncer = Arc::new(SubsquidSyncer::new(CHAIN.subsquid_endpoint));
    let rpc_syncer = Arc::new(RpcSyncer::new(provider.clone(), CHAIN).with_batch_size(10));
    let syncer = Arc::new(ChainedSyncer::new(vec![
        subsquid_syncer.clone(),
        rpc_syncer,
    ]));

    let poi_client = PoiClient::new(CHAIN.poi_endpoint, CHAIN.id).await.unwrap();
    let list_key = poi_client.list_keys().first().unwrap().clone();

    let mut railgun = PoiProvider::new(
        CHAIN,
        provider.clone(),
        syncer,
        prover.clone(),
        subsquid_syncer,
        poi_client,
        prover,
    );

    info!("Setting up accounts");
    let account_1 =
        railgun_rs::railgun::signer::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);
    let account_2 =
        railgun_rs::railgun::signer::PrivateKeySigner::new_evm(random(), random(), CHAIN.id);

    info!("Syncing to latest block");
    railgun.sync().await.unwrap();
    railgun.register(account_1.clone());
    railgun.register(account_2.clone());

    // Test Shielding
    info!("Testing shield");
    test_shield_poi(
        &mut railgun,
        &provider,
        account_1.clone(),
        account_2.clone(),
        &list_key,
    )
    .await;

    // Test Transfer
    info!("Testing transfer");
    test_transfer_poi(
        &mut railgun,
        &provider,
        account_1.clone(),
        account_2.clone(),
        &list_key,
    )
    .await;

    // Test Unshielding
    info!("Testing unshielding");
    test_unshield_poi(
        &mut railgun,
        &provider,
        account_1.clone(),
        account_2.clone(),
        &list_key,
    )
    .await;
}

async fn test_shield_poi(
    railgun: &mut PoiProvider,
    provider: &DynProvider,
    account_1: Arc<dyn Signer>,
    account_2: Arc<dyn Signer>,
    list_key: &ListKey,
) {
    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), USDC, 10)
        .build(&mut rand::rng())
        .unwrap();

    let tx = provider
        .send_transaction(shield_tx.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    info!("Shielded with tx hash: {:?}", tx.transaction_hash);
    await_balance_update(railgun, account_1.clone(), USDC, list_key, Some(10)).await;
    await_balance_update(railgun, account_2.clone(), USDC, list_key, None).await;
}

async fn test_transfer_poi(
    railgun: &mut PoiProvider,
    provider: &DynProvider,
    account_1: Arc<dyn Signer>,
    account_2: Arc<dyn Signer>,
    list_key: &ListKey,
) {
    let tx = PoiTransactionBuilder::new().transfer(
        account_1.clone(),
        account_2.address(),
        USDC,
        5,
        "test transfer",
    );
    let transfer_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    let tx = provider
        .send_transaction(transfer_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    info!("Transferred with tx hash: {:?}", tx.transaction_hash);

    await_balance_update(railgun, account_1.clone(), USDC, list_key, Some(5)).await;
    await_balance_update(railgun, account_2.clone(), USDC, list_key, Some(5)).await;
}

async fn test_unshield_poi(
    railgun: &mut PoiProvider,
    provider: &DynProvider,
    account_1: Arc<dyn Signer>,
    account_2: Arc<dyn Signer>,
    list_key: &ListKey,
) {
    let tx = PoiTransactionBuilder::new().set_unshield(
        account_1.clone(),
        address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"),
        USDC,
        2,
    );
    let unshield_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    let usdc_contract = ERC20::new(USDC_ADDRESS, provider.clone());
    let pre_unshield_balance_eoa = usdc_contract
        .balanceOf(address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"))
        .call()
        .await
        .unwrap();

    let tx = provider
        .send_transaction(unshield_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    info!("Unshielded with tx hash: {:?}", tx.transaction_hash);

    let post_unshield_balance_eoa = usdc_contract
        .balanceOf(address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"))
        .call()
        .await
        .unwrap();

    await_balance_update(railgun, account_1.clone(), USDC, list_key, Some(3)).await;
    await_balance_update(railgun, account_2.clone(), USDC, list_key, Some(5)).await;

    let delta_balance_eoa = post_unshield_balance_eoa - pre_unshield_balance_eoa;
    assert_eq!(delta_balance_eoa, 2);
}

async fn await_balance_update(
    railgun: &mut PoiProvider,
    account: Arc<dyn Signer>,
    asset: AssetId,
    list_key: &ListKey,
    expected: Option<u128>,
) {
    let start = std::time::Instant::now();
    loop {
        info!("Waiting for balance to update...");
        sleep(web_time::Duration::from_secs(10)).await;

        if start.elapsed().as_secs() > 100 {
            panic!("Balance did not update within 100 seconds");
        }

        railgun.sync().await.unwrap();
        let balance = railgun.balance(account.address(), &list_key).await;
        info!("Balance: {:?}", balance);

        if balance.get(&(PoiStatus::Valid, asset)) == expected.as_ref() {
            return;
        }
    }
}
