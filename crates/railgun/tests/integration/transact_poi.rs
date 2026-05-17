use std::{str::FromStr, sync::Arc};

use alloy::{
    network::Ethereum,
    primitives::{Address, address},
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
    provider::RailgunProvider,
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

const USDC_ADDRESS: Address = address!("0x1c7d4b196cb0c7b01d743fbc6116a902379c7238");
const USDC: AssetId = AssetId::Erc20(USDC_ADDRESS);

/// Tests a full POI transact flow including shielding, transferring, and unshielding.
///
/// This integration test ensures that the entire POI transact flow works correctly
/// using the public PoiProvider interface. Includes internal syncing, tx building,
/// UTXO management, UTXO/TXID proof generation, and POI submission.
///
/// WARNING: This test currently runs against the real Sepolia testnet, and will
/// submit real transactions that affect real funds. Minimal amounts are used,
/// but ensure a throwaway DEV_KEY account is funded with testnet ETH and USDC
/// before running.
///
/// The test is run on Sepolia because the POI submission process relies on
/// submitting POI proofs to a real POI endpoint, which in turn verifies that the
/// proofs are valid against the real chain state.
///
/// TODO: Make this a snapshot test that runs against a local fork with a mocked POI
/// endpoint, and only runs against sepolia when the snapshot needs to be refreshed.
#[tokio::test]
#[serial_test::serial]
#[ignore]
async fn test_transact_poi() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let chain = ChainConfig::sepolia();

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
    let syncer = Arc::new(
        ChainedSyncer::new()
            .then(SubsquidSyncer::new(&chain.subsquid_endpoint))
            .then(RpcSyncer::new(chain.clone(), provider.clone()).with_batch_size(1000)),
    );
    let mut railgun = RailgunBuilder::new(chain.clone(), provider.clone())
        .with_utxo_syncer(syncer)
        .with_poi()
        .build()
        .await
        .unwrap();

    info!("Setting up accounts");
    let account_1 =
        railgun::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);
    let account_2 =
        railgun::account::signer::PrivateKeySigner::new_evm(random(), random(), chain.id);

    info!("Syncing to latest block");
    railgun.sync().await.unwrap();
    railgun.register(account_1.clone()).await.unwrap();
    railgun.register(account_2.clone()).await.unwrap();

    // Test Shielding
    info!("Testing shield");
    test_shield_poi(
        &mut railgun,
        &provider,
        account_1.clone(),
        account_2.clone(),
    )
    .await;

    // Test Transfer
    info!("Testing transfer");
    test_transfer_poi(
        &mut railgun,
        &provider,
        account_1.clone(),
        account_2.clone(),
    )
    .await;

    // Test Unshielding
    info!("Testing unshielding");
    test_unshield_poi(
        &mut railgun,
        &provider,
        account_1.clone(),
        account_2.clone(),
    )
    .await;
}

async fn test_shield_poi(
    railgun: &mut RailgunProvider,
    provider: &impl Provider,
    account_1: Arc<dyn RailgunSigner>,
    account_2: Arc<dyn RailgunSigner>,
) {
    let shield_tx = railgun
        .shield()
        .shield(account_1.address(), USDC, 10)
        .build(&mut rand::rng())
        .unwrap();

    for tx in shield_tx {
        let receipt = provider
            .send_transaction(tx.into())
            .await
            .unwrap()
            .get_receipt()
            .await
            .unwrap();

        info!("Shielded with tx hash: {:?}", receipt.transaction_hash);
    }
    await_balance_update(railgun, account_1.clone(), USDC, Some(10)).await;
    await_balance_update(railgun, account_2.clone(), USDC, None).await;
}

async fn test_transfer_poi<P: Provider>(
    railgun: &mut RailgunProvider,
    provider: &P,
    account_1: Arc<dyn RailgunSigner>,
    account_2: Arc<dyn RailgunSigner>,
) {
    let tx = railgun.transact().transfer(
        account_1.clone(),
        account_2.address(),
        USDC,
        1,
        "test transfer",
    );
    let transfer_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    info!("Sending transfer transaction");
    let tx = provider
        .send_transaction(transfer_tx.tx_data.into())
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    info!("Transferred with tx hash: {:?}", tx.transaction_hash);

    await_balance_update(railgun, account_1.clone(), USDC, Some(9)).await;
    await_balance_update(railgun, account_2.clone(), USDC, Some(1)).await;
}

async fn test_unshield_poi<P: Provider>(
    railgun: &mut RailgunProvider,
    provider: &P,
    account_1: Arc<dyn RailgunSigner>,
    account_2: Arc<dyn RailgunSigner>,
) {
    let tx = railgun
        .transact()
        .unshield(
            account_1.clone(),
            address!("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86"),
            USDC,
            2,
        )
        .unwrap();
    let unshield_tx = railgun.build(tx, &mut rand::rng()).await.unwrap();

    let usdc_contract = ERC20::new(USDC_ADDRESS, provider);
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

    await_balance_update(railgun, account_1.clone(), USDC, Some(7)).await;
    await_balance_update(railgun, account_2.clone(), USDC, Some(1)).await;

    let delta_balance_eoa = post_unshield_balance_eoa - pre_unshield_balance_eoa;
    assert_eq!(delta_balance_eoa, 2);
}

async fn await_balance_update(
    railgun: &mut RailgunProvider,
    account: Arc<dyn RailgunSigner>,
    asset: AssetId,
    expected: Option<u128>,
) {
    let start = std::time::Instant::now();
    loop {
        info!("Waiting for balance to update...");
        common::sleep(web_time::Duration::from_secs(10)).await;

        if start.elapsed().as_secs() > 300 {
            panic!("Balance did not update within 300 seconds");
        }

        railgun.sync().await.unwrap();
        let balance = railgun.balance(account.address()).await;
        info!("Balance: {:?}, Expected: {:?}", balance, expected);

        if balance.get(&asset) == expected.as_ref() {
            return;
        }
    }
}
