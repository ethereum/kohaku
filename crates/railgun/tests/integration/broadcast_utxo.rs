use std::{str::FromStr, sync::Arc, time::Duration};

use alloy::{
    network::Ethereum,
    primitives::U256,
    providers::{DynProvider, Provider, ProviderBuilder},
    sol,
};
use railgun::{
    account::signer::RailgunSigner,
    builder::RailgunBuilder,
    caip::AssetId,
    chain_config::ChainConfig,
    crypto::keys::{HexKey, SpendingKey, ViewingKey},
    indexer::syncer::{ChainedSyncer, RpcSyncer, SubsquidSyncer},
    transact::TransactionBuilder,
};
use tokio::time::sleep;
use tracing::info;
use tracing_subscriber::EnvFilter;
use userop_kit::{
    bundler::{Bundler, pimlico::PimlicoBundler},
    entry_point::ENTRY_POINT_08,
    smart_account::simple_smart_account::{self, SimpleSmartAccount},
};

use crate::utils::{Alto, AltoBuilder, Anvil, AnvilBuilder};

sol! {
    #[sol(rpc)]
    // WETH interface
    contract WETH {
        function approve(address guy, uint256 wad) external returns (bool);
        function balanceOf(address input) external view returns (uint256);
        function deposit() external payable;
        function withdraw(uint256 wad) external;
    }
}

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
async fn test_broadcast_utxo() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_test_writer()
        .try_init()
        .ok();

    let chain = ChainConfig::sepolia();

    info!("Setting up alloy provider");
    let fork_url = std::env::var("RPC_URL_SEPOLIA").expect("RPC_URL_SEPOLIA must be set");
    let fork_block = 11011021;
    // let fork_block = 25269258;
    let signer_key = std::env::var("DEV_KEY").expect("DEV_KEY must be set");
    let signer = alloy::signers::local::PrivateKeySigner::from_str(&signer_key)?;

    let (provider, _anvil) = setup_provider(&fork_url, fork_block, signer, true).await?;

    info!("Setting up railgun signer");
    let spending_key = std::env::var("DEV_SPENDING_KEY").expect("DEV_SPENDING_KEY must be set");
    let spending_key = SpendingKey::from_hex(&spending_key)?;
    let viewing_key = std::env::var("DEV_VIEWING_KEY").expect("DEV_VIEWING_KEY must be set");
    let viewing_key = ViewingKey::from_hex(&viewing_key)?;
    let railgun_signer =
        railgun::account::signer::PrivateKeySigner::new_evm(spending_key, viewing_key, chain.id);

    info!("Setting up alto");
    let pimlico_url = format!("https://public.pimlico.io/v2/{}/rpc", chain.id);
    let (bundler, _alto) = setup_bundler(provider.clone(), &pimlico_url, true).await?;

    info!("Setting up railgun");
    let syncer = Arc::new(
        ChainedSyncer::new()
            .then(SubsquidSyncer::new(&chain.subsquid_endpoint).with_latest_block(fork_block))
            .then(RpcSyncer::new(chain.clone(), provider.clone()).with_batch_size(1000)),
    );
    let mut railgun = RailgunBuilder::new(chain.clone(), provider.clone())
        .with_utxo_syncer(syncer)
        .build()
        .await?;

    railgun.register(railgun_signer.clone()).await?;
    railgun.sync().await?;

    // Test Shielding
    info!("Testing shielding");
    let shield_tx = railgun
        .shield()
        .shield_native(railgun_signer.address(), 4_000_000_000_000_000)
        .build(&mut rand::rng())?;

    for tx in shield_tx {
        info!("Sending shielding transaction");
        provider
            .send_transaction(tx.into())
            .await?
            .get_receipt()
            .await?;
    }

    sleep(Duration::from_secs(12)).await;
    railgun.sync().await?;
    let railgun_balance = railgun.balance(railgun_signer.address()).await;
    info!("Railgun balance: {:?}", railgun_balance);

    // Test Unshield
    let weth = AssetId::Erc20(chain.wrapped_base_token);
    let weth_contract = WETH::new(chain.wrapped_base_token, provider.clone());

    let smart_account_signer = alloy::signers::local::PrivateKeySigner::random();
    let smart_account =
        SimpleSmartAccount::new(smart_account_signer.address(), chain.id, provider.clone());

    info!("Testing unshielding");
    let tx = TransactionBuilder::new().unshield(
        railgun_signer.clone(),
        smart_account_signer.address(),
        weth,
        5_000,
    )?;

    let unwrap_call = simple_smart_account::Call {
        target: chain.wrapped_base_token,
        value: U256::ZERO,
        data: weth_contract.withdraw(U256::from(3_000)).calldata().clone(),
    };

    let signable = railgun
        .prepare_userop(
            tx,
            bundler.as_ref(),
            &smart_account,
            railgun_signer.clone(),
            chain.wrapped_base_token,
            vec![unwrap_call],
            &mut rand::rng(),
        )
        .await?;

    let pre_eoa_balance = provider.get_balance(smart_account_signer.address()).await?;
    let pre_weth_balance = weth_contract
        .balanceOf(smart_account_signer.address())
        .call()
        .await?;

    let signed = signable.sign(&smart_account_signer).await?;
    let hash = bundler.send_user_operation(&signed).await?;
    let receipt = bundler.wait_for_receipt(hash).await?;
    assert!(
        receipt.success,
        "Broadcast transaction failed: {:?}",
        receipt
    );

    info!("Broadcast transaction succeeded: {:?}", receipt);
    info!("Waiting 24s for transaction indexing");
    sleep(Duration::from_secs(24)).await;

    railgun.sync().await?;
    let railgun_balance = railgun.balance(railgun_signer.address()).await;
    info!("Railgun balance after unshield: {:?}", railgun_balance);

    let post_weth_balance = weth_contract
        .balanceOf(smart_account_signer.address())
        .call()
        .await?;
    info!("Pre-unshield WETH balance: {}", pre_weth_balance);
    info!("Post-unshield WETH balance: {}", post_weth_balance);

    let post_eoa_balance = provider.get_balance(smart_account_signer.address()).await?;
    info!("Pre-unshield EOA balance: {}", pre_eoa_balance);
    info!("Post-unshield EOA balance: {}", post_eoa_balance);
    Ok(())
}

async fn setup_provider(
    rpc_url: &str,
    block_number: u64,
    signer: alloy::signers::local::PrivateKeySigner,
    local: bool,
) -> Result<(DynProvider, Option<Anvil>), anyhow::Error> {
    if !local {
        let provider = ProviderBuilder::new()
            .network::<Ethereum>()
            .wallet(signer)
            .connect(rpc_url)
            .await?
            .erased();
        return Ok((provider, None));
    }

    let anvil = AnvilBuilder::new()
        .fork_url(rpc_url)
        .fork_block(block_number)
        .spawn()
        .await;

    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .wallet(signer)
        .connect(&"http://localhost:8545")
        .await?
        .erased();

    Ok((provider, Some(anvil)))
}

async fn setup_bundler(
    provider: DynProvider,
    pimlico_url: &str,
    local: bool,
) -> Result<(Arc<dyn Bundler>, Option<Alto>), anyhow::Error> {
    if !local {
        let pimlico_url = pimlico_url.parse()?;
        let bundler = Arc::new(PimlicoBundler::new(pimlico_url));
        return Ok((bundler, None));
    }

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
        .spawn()
        .await;

    let alto_url = "http://localhost:3000".parse()?;
    let bundler = Arc::new(PimlicoBundler::new(alto_url));
    Ok((bundler, Some(_alto)))
}
