import { RailgunAccount, getAllLogs, RailgunLog } from '../src/account-utils';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../src/config';
import { EthersProviderAdapter } from '../src/provider';
import { ByteUtils } from '../src/railgun-lib/utils/bytes';
import dotenv from 'dotenv';
import { Wallet, JsonRpcProvider } from 'ethers';
import sepolia_checkpoint from '../checkpoints/sepolia_public_checkpoint.json';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import { SerializedNoteData } from '../src/railgun-logic/logic/note';

// Load ./demo/.env (same folder as this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

// types for process.env
type ProcessEnv = {
  MNEMONIC: string;
  ACCOUNT_INDEX: string;
  RPC_URL: string;
  TX_SIGNER_KEY: string;
}

const env: ProcessEnv = process.env as unknown as ProcessEnv;

const MNEMONIC = env.MNEMONIC || 'test test test test test test test test test test test junk';
const ACCOUNT_INDEX = Number(env.ACCOUNT_INDEX) || 0;
const RPC_URL = env.RPC_URL || '';
const TX_SIGNER_KEY = env.TX_SIGNER_KEY || '';
const VALUE = 10000000000000n; // 0.00001 ETH
const RANDOM_RAILGUN_RECEIVER = "0zk1qyhl9p096zdc34x0eh7vdarr73xjfymq2xeef3nhkvgg2vlynzwdlrv7j6fe3z53lalqtuna0f5hkrt3ket0wl9mket7ck8jthq807d7fyq5u4havp4v2u70sva";

type PublicCache = {
  logs: RailgunLog[];
  merkleTrees: {tree: string[][], nullifiers: string[]}[];
  endBlock: number;
}

type PrivateCache = {
  noteBooks: SerializedNoteData[][];
  endBlock: number;
}

async function main() {
  console.log("\n ///// RAILGUN SEPOLIA DEMO /////\n");
  const chainId = '11155111' as const;

  // 1. instantiate account from mnemonic
  const railgunAccount = RailgunAccount.fromMnemonic(MNEMONIC, ACCOUNT_INDEX, chainId);

  // 2. get railgun 0zk address
  const zkAddress = await railgunAccount.getRailgunAddress();
  console.log('0zk address:', zkAddress);

  // 3. sync account and display state
  if (RPC_URL === '') {
    console.error("\nERROR: RPC_URL not set");
    process.exit(1);
  }
  const baseProvider = new JsonRpcProvider(RPC_URL);
  const network = await baseProvider.getNetwork();
  if (network.chainId !== BigInt(chainId)) {
    console.error(`\nERROR: wrong chain provider (expect chainId 11155111, got: ${Number(chainId)})`);
    process.exit(1);
  }
  const provider = new EthersProviderAdapter(new JsonRpcProvider(RPC_URL, network, {
    staticNetwork: true,
    batchMaxCount: 1,
    batchMaxSize: 0,
    batchStallTime: 0,
  }));

  if (!fs.existsSync('./demo/cache/')) {
    fs.mkdirSync('./demo/cache/', { recursive: true });
  }

  const publicCacheExists = fs.existsSync('./demo/cache/sepolia_public.json');
  const public_cache = publicCacheExists ? JSON.parse(fs.readFileSync('./demo/cache/sepolia_public.json', 'utf8')) as PublicCache : sepolia_checkpoint as unknown as PublicCache;

  console.log("\nresyncing railgun account...");
  console.log("    -> WARNING: can be slow (e.g. minutes) on first run without local cache...")
  await railgunAccount.loadCachedMerkleTrees(public_cache.merkleTrees);
  const privateCacheExists = fs.existsSync(`./demo/cache/sepolia_${zkAddress}.json`);
  if (privateCacheExists) {
    const private_cache = JSON.parse(fs.readFileSync(`./demo/cache/sepolia_${zkAddress}.json`, 'utf8')) as PrivateCache;
    await railgunAccount.loadCachedNoteBooks(private_cache.noteBooks);
    if (private_cache.endBlock < public_cache.endBlock) {
      await railgunAccount.syncWithLogs(public_cache.logs.filter(log => log.blockNumber > private_cache.endBlock), true);
    }
  } else {
    await railgunAccount.syncWithLogs(public_cache.logs, true);
  }
  let startBlock = public_cache.endBlock > 0 ? public_cache.endBlock : RAILGUN_CONFIG_BY_CHAIN_ID[chainId.toString() as keyof typeof RAILGUN_CONFIG_BY_CHAIN_ID].GLOBAL_START_BLOCK;
  let endBlock = await provider.getBlockNumber();
  console.log(`    -> fetching new logs from start block (${startBlock}) to latest block (${endBlock})...`);
  const newLogs = await getAllLogs(provider, chainId, startBlock, endBlock);
  if (newLogs.length > 0) {
    console.log(`    -> syncing ${newLogs.length} new logs...`);
    await railgunAccount.syncWithLogs(newLogs);
  }

  const balance = await railgunAccount.getBalance();
  console.log("\nprivate WETH balance:", balance);
  const root = railgunAccount.getLatestMerkleRoot();
  console.log("root:", ByteUtils.hexlify(root, true));

  // 4. create shield ETH tx data 
  const shieldNativeTx = await railgunAccount.createNativeShieldTx(VALUE);

  // 5. do shield tx
  if (TX_SIGNER_KEY === '') {
    console.error("\nERROR: TX_SIGNER_KEY not set");
    process.exit(1);
  }
  const txSigner = new Wallet(TX_SIGNER_KEY, provider.getProvider());

  const shieldTxHash = await railgunAccount.submitTx(shieldNativeTx, txSigner);
  console.log('shield ETH tx:', shieldTxHash);
  await provider.waitForTransaction(shieldTxHash);
  const x = await provider.getProvider().getTransactionReceipt(shieldTxHash);
  console.log({x});

  // 6. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  startBlock = endBlock;
  endBlock = await provider.getBlockNumber();
  const newLogs2 = await getAllLogs(provider, chainId, startBlock, endBlock);
  await railgunAccount.syncWithLogs(newLogs2);
  const balance2 = await railgunAccount.getBalance();
  console.log("\nnew private WETH balance:", balance2);
  const root2 = railgunAccount.getLatestMerkleRoot();
  console.log("new root:", ByteUtils.hexlify(root2, true));

  // 7. create internal private transfer tx data
  const weth = RAILGUN_CONFIG_BY_CHAIN_ID[chainId.toString() as keyof typeof RAILGUN_CONFIG_BY_CHAIN_ID].WETH;
  const internalTransactTx = await railgunAccount.createPrivateTransferTx(weth, balance2/10n, RANDOM_RAILGUN_RECEIVER);
  
  // 8. do internal private transfer tx
  const internalTransactTxHash = await railgunAccount.submitTx(internalTransactTx, txSigner);
  console.log("private transfer tx:", internalTransactTxHash);
  await provider.waitForTransaction(internalTransactTxHash);

  // 9. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  startBlock = endBlock;
  endBlock = await provider.getBlockNumber();
  const newLogs3 = await getAllLogs(provider, chainId, startBlock, endBlock);
  await railgunAccount.syncWithLogs(newLogs3);
  const balance3 = await railgunAccount.getBalance();
  console.log("\nnew private WETH balance:", balance3);
  const root3 = railgunAccount.getLatestMerkleRoot();
  console.log("new root:", ByteUtils.hexlify(root3, true));

  // 10. create unshield tx data
  const unshieldNativeTx = await railgunAccount.createNativeUnshieldTx(balance3, txSigner.address);

  // 11. do unshield tx
  const unshieldTxHash = await railgunAccount.submitTx(unshieldNativeTx, txSigner);
  console.log("unshield tx:", unshieldTxHash);
  await provider.waitForTransaction(unshieldTxHash);

  // 12. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  startBlock = endBlock;
  endBlock = await provider.getBlockNumber();
  const newLogs4 = await getAllLogs(provider, chainId, startBlock, endBlock);
  await railgunAccount.syncWithLogs(newLogs4);
  const balance4 = await railgunAccount.getBalance();
  console.log("\nnew private WETH balance:", balance4);
  const root4 = railgunAccount.getLatestMerkleRoot();
  console.log("new (or same) root:", ByteUtils.hexlify(root4, true));

  // 13. save cache for faster syncing next time
  console.log('storing updated cache before exiting...');
  const allLogs = Array.from(new Set(public_cache.logs.concat(newLogs).concat(newLogs2).concat(newLogs3).concat(newLogs4)));
  const toCachePublic = {
    logs: allLogs,
    merkleTrees: railgunAccount.serializeMerkleTrees(),
    endBlock: endBlock,
  };
  fs.writeFileSync('./demo/cache/sepolia_public.json', JSON.stringify(toCachePublic, null, 2));
  const toCachePrivate = {
    noteBooks: railgunAccount.serializeNoteBooks(),
    endBlock: endBlock,
  };
  fs.writeFileSync(`./demo/cache/sepolia_${zkAddress}.json`, JSON.stringify(toCachePrivate, null, 2));

  // exit (because prover hangs)
  setImmediate(() => process.exit(0));
}

main();
