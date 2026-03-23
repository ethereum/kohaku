use std::{
    fs,
    io::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use alloy::{network::Ethereum, providers::ProviderBuilder};
use clap::Parser;
use serde::Deserialize;
use tc_rs::{
    POOLS,
    indexer::{RpcSyncer, Syncer},
};
use tracing::info;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    dir: PathBuf,
}

#[derive(Deserialize)]
struct BlockNumberOnly {
    block_number: u64,
}

fn last_block_number(path: &Path) -> Option<u64> {
    let content = fs::read_to_string(path).ok()?;
    content
        .lines()
        .filter(|l| !l.is_empty())
        .last()
        .and_then(|l| serde_json::from_str::<BlockNumberOnly>(l).ok())
        .map(|e| e.block_number)
}

fn rpc_url_for_chain(chain_id: u64) -> Option<String> {
    let var_name = match chain_id {
        1 => "RPC_URL_MAINNET",
        11155111 => "RPC_URL_SEPOLIA",
        10 => "RPC_URL_OPTIMISM",
        _ => return None,
    };
    std::env::var(var_name).ok()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    fs::create_dir_all(&args.dir)?;

    for pool in POOLS {
        let Some(rpc_url) = rpc_url_for_chain(pool.chain_id) else {
            info!("Skipping pool {} (no RPC URL configured)", pool);
            continue;
        };

        let prefix = format!("{}_{}_{}", pool.chain_id, pool.symbol(), pool.amount());
        let deposits_path = args.dir.join(format!("{prefix}_deposits.ndjson"));
        let nullifiers_path = args.dir.join(format!("{prefix}_nullifiers.ndjson"));

        let from_block = [
            last_block_number(&deposits_path),
            last_block_number(&nullifiers_path),
        ]
        .into_iter()
        .flatten()
        .max()
        .map(|b| b + 1)
        .unwrap_or(0);
        let from_block = from_block.max(pool.deployed_block);

        let provider = ProviderBuilder::new()
            .network::<Ethereum>()
            .connect(&rpc_url)
            .await?;
        let rpc_syncer = RpcSyncer::new(Arc::new(provider)).with_batch_size(200_000);

        let latest_block = rpc_syncer.latest_block(pool.address).await?;
        info!("{prefix}: from_block={from_block}, latest={latest_block}");

        if from_block > latest_block {
            info!("{prefix}: already up to date");
            continue;
        }

        let commitments = rpc_syncer
            .sync_commitments(pool.address, from_block, latest_block)
            .await?;
        let nullifiers = rpc_syncer
            .sync_nullifiers(pool.address, from_block, latest_block)
            .await?;

        info!(
            "{prefix}: {} deposits, {} withdrawals",
            commitments.len(),
            nullifiers.len()
        );

        let mut deposits_file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&deposits_path)?;
        for c in &commitments {
            writeln!(deposits_file, "{}", serde_json::to_string(c)?)?;
        }

        let mut nullifiers_file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&nullifiers_path)?;
        for n in &nullifiers {
            writeln!(nullifiers_file, "{}", serde_json::to_string(n)?)?;
        }
    }

    info!("Done");
    Ok(())
}
