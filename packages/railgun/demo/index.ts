import { RailgunAccount, FEE_BASIS_POINTS, getAllReceipts, GLOBAL_START_BLOCK } from '../src/account-utils';
import { ByteUtils } from '../src/railgun-lib/utils/bytes';
import dotenv from 'dotenv';
import { Wallet, JsonRpcProvider, TransactionReceipt } from 'ethers';
import cached_file from './cached_sepolia.json';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

// Load ./demo/.env (same folder as this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const MNEMONIC = process.env.MNEMONIC || 'test test test test test test test test test test test junk';
const ACCOUNT_INDEX = Number(process.env.ACCOUNT_INDEX) || 0;
const RPC_URL = process.env.RPC_URL || '';
const TX_SIGNER_KEY = process.env.TX_SIGNER_KEY || '';
const VALUE = 10000000000000n; // 0.00001 ETH

type Cache = {
  receipts: TransactionReceipt[];
  endBlock: number;
}

async function main() {
  console.log("\n ///// RAILGUN SEPOLIA DEMO /////\n");

  // 1. instantiate account from mnemonic
  const railgunAccount = RailgunAccount.fromMnemonic(MNEMONIC, ACCOUNT_INDEX);
  await railgunAccount.init();

  // 2. get railgun 0zk address
  const zkAddress = await railgunAccount.getRailgunAddress();
  console.log('0zk address:', zkAddress);

  // 3. sync account and display state
  if (RPC_URL === '') {
    console.error("\nERROR: RPC_URL not set");
    process.exit(1);
  }
  const provider = new JsonRpcProvider(RPC_URL);
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== 11155111) {
    console.error(`\nERROR: wrong chain provider (expect chainId 11155111, got: ${Number(chainId)})`);
    process.exit(1);
  }

  const cached: Cache = cached_file as unknown as Cache;

  let startBlock = cached ? cached.endBlock : GLOBAL_START_BLOCK;
  let endBlock = await provider.getBlockNumber();
  const receipts = await getAllReceipts(provider, startBlock, endBlock);
  const combinedReceipts = cached ? Array.from(new Set(cached.receipts.concat(receipts))) : receipts;
  await railgunAccount.syncWithReceipts(combinedReceipts);

  const balance = await railgunAccount.getBalance();
  console.log("private WETH balance:", balance);
  const root = railgunAccount.getMerkleRoot(0);
  console.log("root:", ByteUtils.hexlify(root, true));

  // 4. create shield ETH tx data 
  const shieldNativeTx = await railgunAccount.createNativeShieldTx(VALUE);

  // 5. do shield tx
  if (TX_SIGNER_KEY === '') {
    console.error("\nERROR: TX_SIGNER_KEY not set");
    process.exit(1);
  }
  const txSigner = new Wallet(TX_SIGNER_KEY, provider);

  const shieldTxHash = await railgunAccount.submitTx(shieldNativeTx, txSigner);
  console.log('shield ETH tx:', shieldTxHash);
  await provider.waitForTransaction(shieldTxHash);

  // 6. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  startBlock = endBlock;
  endBlock = await provider.getBlockNumber();
  const newReceipts = await getAllReceipts(provider, startBlock, endBlock);
  await railgunAccount.syncWithReceipts(newReceipts);
  const balance2 = await railgunAccount.getBalance();
  console.log("new private WETH balance:", balance2);
  const root2 = railgunAccount.getMerkleRoot(0);
  console.log("new root:", ByteUtils.hexlify(root2, true));

  // 7. create unshield ETH tx data
  const reducedValue = VALUE - (VALUE * FEE_BASIS_POINTS / 10000n);
  const unshieldNativeTx = await railgunAccount.createNativeUnshieldTx(reducedValue, txSigner.address);

  // 8. do unshield tx
  const unshieldTxHash = await railgunAccount.submitTx(unshieldNativeTx, txSigner);
  console.log("unshield tx:", unshieldTxHash);
  await provider.waitForTransaction(unshieldTxHash);

  // 9. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  startBlock = endBlock;
  endBlock = await provider.getBlockNumber();
  const newReceipts2 = await getAllReceipts(provider, startBlock, endBlock);
  await railgunAccount.syncWithReceipts(newReceipts2);
  const balance3 = await railgunAccount.getBalance();
  console.log("new private WETH balance:", balance3);
  const root3 = railgunAccount.getMerkleRoot(0);
  console.log("new root:", ByteUtils.hexlify(root3, true));

  // 10. If desired, save cache for faster syncing next time
  console.log('storing updated cache before exiting...');
  const allReceipts = Array.from(new Set(combinedReceipts.concat(newReceipts).concat(newReceipts2)));
  const toCache = {
    receipts: allReceipts,
    endBlock: endBlock,
  };
  fs.writeFileSync('./demo/cached_sepolia.json', JSON.stringify(toCache, null, 2));

  // exit (because prover hangs)
  setImmediate(() => process.exit(0));
}

main();