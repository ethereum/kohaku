import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { JsonRpcProvider, Wallet } from "ethers";

import { createFileStorageLayer } from "~/storage/layers/file";

import { createRailgunAccount, createRailgunIndexer } from "../src";
import { RAILGUN_CONFIG_BY_CHAIN_ID } from "../src/config";
import { EthersProviderAdapter, EthersSignerAdapter } from "../src/provider";

// Load ./demo/.env (same folder as this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, ".env") });

// types for process.env
type ProcessEnv = {
  MNEMONIC: string;
  ACCOUNT_INDEX: string;
  RPC_URL: string;
  TX_SIGNER_KEY: string;
};

const env: ProcessEnv = process.env as unknown as ProcessEnv;

const MNEMONIC =
  env.MNEMONIC || "test test test test test test test test test test test junk";
const ACCOUNT_INDEX = Number(env.ACCOUNT_INDEX) || 0;
const RPC_URL = env.RPC_URL || "";
const TX_SIGNER_KEY = env.TX_SIGNER_KEY || "";
const VALUE = 10000000000000n; // 0.00001 ETH
const RANDOM_RAILGUN_RECEIVER =
  "0zk1qyhl9p096zdc34x0eh7vdarr73xjfymq2xeef3nhkvgg2vlynzwdlrv7j6fe3z53lalqtuna0f5hkrt3ket0wl9mket7ck8jthq807d7fyq5u4havp4v2u70sva";

async function main() {
  console.log("\n ///// RAILGUN SEPOLIA DEMO /////\n");
  const chainId = "11155111" as const;

  // 3. sync account and display state
  if (RPC_URL === "") {
    console.error("\nERROR: RPC_URL not set");
    process.exit(1);
  }

  const baseProvider = new JsonRpcProvider(RPC_URL);
  const network = await baseProvider.getNetwork();

  if (network.chainId !== BigInt(chainId)) {
    console.error(
      `\nERROR: wrong chain provider (expect chainId 11155111, got: ${Number(
        chainId
      )})`
    );
    process.exit(1);
  }

  const provider = new EthersProviderAdapter(
    new JsonRpcProvider(RPC_URL, network, {
      staticNetwork: true,
      batchMaxCount: 1,
      batchMaxSize: 0,
      batchStallTime: 0,
    })
  );

  // 1. instantiate indexer and account from mnemonic
  const indexer = await createRailgunIndexer({
    network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
    provider,
    storage: createFileStorageLayer(
      "./checkpoints/sepolia_public_checkpoint.json"
    ),
  });

  const railgunAccount = await createRailgunAccount({
    credential: {
      type: "mnemonic",
      mnemonic: MNEMONIC,
      accountIndex: ACCOUNT_INDEX,
    },
    indexer,
    storage: createFileStorageLayer("./demo/account.json"),
  });

  // 2. get railgun 0zk address
  const zkAddress = await railgunAccount.getRailgunAddress();

  console.log("0zk address:", zkAddress);

  // 3. Load and sync indexer with cached state
  if (!fs.existsSync("./demo/cache/")) {
    fs.mkdirSync("./demo/cache/", { recursive: true });
  }

  // const publicCacheExists = fs.existsSync('./demo/cache/sepolia_public.json');
  // const public_cache = publicCacheExists ? JSON.parse(fs.readFileSync('./demo/cache/sepolia_public.json', 'utf8')) as PublicCache : sepolia_checkpoint as unknown as PublicCache;

  console.log("\nresyncing railgun account...");
  console.log(
    "    -> WARNING: can be slow (e.g. minutes) on first run without local cache..."
  );

  // Load cached merkle trees into indexer
  // await indexer.loadState({ merkleTrees: public_cache.merkleTrees, latestSyncedBlock: public_cache.endBlock });

  // Load cached notebooks into account (if available)
  // const privateCacheExists = fs.existsSync(`./demo/cache/sepolia_${zkAddress}.json`);

  // Note: In production, you would use the storage parameter on account creation
  // For this demo, we're loading the private cache manually if it exists
  // if (privateCacheExists) {
  // const private_cache = JSON.parse(fs.readFileSync(`./demo/cache/sepolia_${zkAddress}.json`, 'utf8')) as PrivateCache;

  // IMPORTANT: Only load private cache if it's in sync with public cache
  // If public cache is older than private cache, private notebooks reference
  // commitments that don't exist in the merkle trees, causing "not found" errors
  //   if (private_cache.endBlock <= public_cache.endBlock) {
  //     // Account notebooks are automatically loaded through storage param in createRailgunAccount
  //     // This demo doesn't use storage param, so we need to replay logs to rebuild notebooks
  //     // We can optimize by only replaying logs from startBlock to private_cache.endBlock
  //     await indexer.processLogs(
  //       public_cache.logs.filter(log => log.blockNumber <= private_cache.endBlock),
  //       { skipMerkleTree: true },
  //     );

  //     // Then process remaining logs if public cache is newer
  //     if (private_cache.endBlock < public_cache.endBlock) {
  //       await indexer.processLogs(
  //         public_cache.logs.filter(log => log.blockNumber > private_cache.endBlock),
  //         { skipMerkleTree: true },
  //       );
  //     }
  //   } else {
  //     console.warn(`\nWARNING: Private cache (block ${private_cache.endBlock}) is ahead of public cache (block ${public_cache.endBlock})`);
  //     console.warn('Rebuilding notebooks from scratch by replaying all logs...\n');
  //     await indexer.processLogs(public_cache.logs, { skipMerkleTree: true });
  //   }
  // } else {
  //   await indexer.processLogs(public_cache.logs, { skipMerkleTree: true });
  // }

  // let startBlock = public_cache.endBlock > 0 ? public_cache.endBlock : RAILGUN_CONFIG_BY_CHAIN_ID[chainId.toString() as keyof typeof RAILGUN_CONFIG_BY_CHAIN_ID].GLOBAL_START_BLOCK;
  let endBlock = await provider.getBlockNumber();

  // console.log(`    -> fetching new logs from start block (${startBlock}) to latest block (${endBlock})...`);
  // const newLogs = await indexer.fetchLogs(startBlock, endBlock);
  await indexer.sync({ toBlock: endBlock, logProgress: true });

  // if (newLogs.length > 0) {
  //   console.log(`    -> syncing ${newLogs.length} new logs...`);
  //   await indexer.processLogs(newLogs);
  // }

  const balance = await railgunAccount.getBalance();

  console.log("\nprivate WETH balance:", balance);
  const root = railgunAccount.getLatestMerkleRoot();

  console.log("root:", root);

  // 4. create shield ETH tx data
  const shieldNativeTx = await railgunAccount.shieldNative(VALUE);

  // 5. do shield tx
  if (TX_SIGNER_KEY === "") {
    console.error("\nERROR: TX_SIGNER_KEY not set");
    process.exit(1);
  }

  const txSigner = new Wallet(TX_SIGNER_KEY, provider.getProvider());
  const ourAddress = await txSigner.getAddress();

  console.log("our address:", ourAddress);
  const signerAdapter = new EthersSignerAdapter(txSigner);

  const shieldTxHash = await signerAdapter.sendTransaction(shieldNativeTx);

  console.log("shield ETH tx:", shieldTxHash);
  await provider.waitForTransaction(shieldTxHash);
  const x = await provider.getProvider().getTransactionReceipt(shieldTxHash);

  console.log({ x });

  // 6. refresh account, show new balance and merkle root
  await new Promise((resolve) => setTimeout(resolve, 2000));

  endBlock = await provider.getBlockNumber();
  await indexer.sync({ toBlock: endBlock, logProgress: true });

  const balance2 = await railgunAccount.getBalance();

  console.log("\nnew private WETH balance:", balance2);
  const root2 = railgunAccount.getLatestMerkleRoot();

  console.log("new root:", root2);

  // 7. create internal private transfer tx data
  const weth = RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.WETH!;
  const internalTransactTx = await railgunAccount.transfer(
    weth,
    balance2 / 10n,
    RANDOM_RAILGUN_RECEIVER
  );

  // 8. do internal private transfer tx
  const internalTransactTxHash = await signerAdapter.sendTransaction(
    internalTransactTx
  );

  console.log("private transfer tx:", internalTransactTxHash);
  await provider.waitForTransaction(internalTransactTxHash);

  // 9. refresh account, show new balance and merkle root
  await new Promise((resolve) => setTimeout(resolve, 2000));
  endBlock = await provider.getBlockNumber();
  await indexer.sync({ toBlock: endBlock, logProgress: true });

  const balance3 = await railgunAccount.getBalance();

  console.log("\nnew private WETH balance:", balance3);
  const root3 = railgunAccount.getLatestMerkleRoot();

  console.log("new root:", root3);

  // 10. create unshield tx data
  const unshieldNativeTx = await railgunAccount.unshield(
    weth,
    balance3,
    ourAddress as `0x${string}`
  );

  // 11. do unshield tx
  const unshieldTxHash = await signerAdapter.sendTransaction(unshieldNativeTx);

  console.log("unshield tx:", unshieldTxHash);
  await provider.waitForTransaction(unshieldTxHash);

  // 12. refresh account, show new balance and merkle root
  await new Promise((resolve) => setTimeout(resolve, 2000));
  endBlock = await provider.getBlockNumber();
  await indexer.sync({ toBlock: endBlock, logProgress: true });

  const balance4 = await railgunAccount.getBalance();

  console.log("\nnew private WETH balance:", balance4);
  const root4 = railgunAccount.getLatestMerkleRoot();

  console.log("new (or same) root:", root4);

  // 13. save cache for faster syncing next time
  console.log("storing updated cache before exiting...");

  // TODO: cleanup

  // exit (because prover hangs)
  setImmediate(() => process.exit(0));
}

main();
