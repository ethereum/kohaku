
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Wallet, Contract } from 'ethers';
import {
  createRailgunAccount,
  createRailgunIndexer,
} from '../../src';
import { TEST_ACCOUNTS } from '../utils/test-accounts';
import { fundAccountWithETH, getETHBalance } from '../utils/test-helpers';
import { ethers, EthersSignerAdapter } from '@kohaku-eth/provider/ethers';
import { defineAnvil, type AnvilInstance } from '../utils/anvil';
// import { loadOrCreateCache } from '../utils/cache';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import { formatEther } from 'viem';
import { createFileStorageLayer } from '../../src/storage/layers/file';
import { createEmptyStorageLayer } from '../../src/storage/layers/empty';

// Helper to get environment variable with fallback
function getEnv(key: string, fallback: string): string {
  if (typeof process.env[key] === 'string' && process.env[key]) {
    return process.env[key] as string;
  }

  return fallback;
}

describe('Railgun E2E Flow', () => {
  let anvil: AnvilInstance;
  let provider: EthereumProvider;
  let alice: Wallet;
  let bob: Wallet;
  let charlie: Wallet;
  // let cachedLogs: TxLog[];
  // let cachedMerkleTrees: { tree: string[][]; nullifiers: string[] }[];
  let forkBlock: number;

  // Use environment variable or fallback to alternative public RPC endpoints
  // Note: Free/public RPC endpoints may rate limit. For reliable tests, use a paid RPC service
  // (Alchemy, Infura paid tier) or wait between test runs to avoid rate limits.
  const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://rpc.sepolia.org');

  const chainId = '11155111' as const;
  const VALUE_TO_SHIELD = BigInt('100000000000000000'); // 0.1 ETH
  const VALUE_TO_TRANSFER = BigInt('50000000000000000'); // 0.05 ETH

  beforeAll(async () => {
    forkBlock = 9327854; // More recent block

    // Setup anvil forking Sepolia
    anvil = defineAnvil({
      forkUrl: SEPOLIA_FORK_URL,
      port: 8545,
      chainId: 11155111,
      forkBlockNumber: forkBlock,
    });

    await anvil.start();

    const jsonRpcProvider = await anvil.getProvider();

    provider = ethers(jsonRpcProvider);

    // Load or create cache for this fork block (this is the slow part on first run)
    console.log(`\nLoading cache for fork block ${forkBlock}...`);
    // const cache = await loadOrCreateCache(provider, chainId, forkBlock);

    // cachedLogs = cache.logs;
    // cachedMerkleTrees = cache.merkleTrees;
    // console.log(`Cache loaded: ${cachedLogs.length} logs, ${cachedMerkleTrees.length} trees\n`);

    // Setup test accounts
    alice = new Wallet(TEST_ACCOUNTS.alice.privateKey, await anvil.getProvider());
    bob = new Wallet(TEST_ACCOUNTS.bob.privateKey, await anvil.getProvider());
    charlie = new Wallet(TEST_ACCOUNTS.charlie.privateKey, await anvil.getProvider());

    // Fund alice with ETH
    await fundAccountWithETH(anvil, alice.address, BigInt('10000000000000000000')); // 10 ETH
    console.log(`Funded ${alice.address} with 10 ETH`);
  }, 300000); // 5 minute timeout for cache creation on first run

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
      console.log('Anvil stopped');
    }
  });

  it('should complete full shield -> transfer -> unshield flow', async () => {
    console.log('\n=== Starting Railgun E2E Test ===\n');

    // Step 1: Create two Railgun accounts and load cached state
    console.log('Step 1: Creating Railgun accounts...');
    const aliceSigner = new EthersSignerAdapter(alice);
    const bobSigner = new EthersSignerAdapter(bob);

    const indexer = await createRailgunIndexer({
      network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
      provider,
      storage: createFileStorageLayer('./tests/utils/checkpoints/sepolia_public_checkpoint.json', { skipWrite: true }),
      startBlock: forkBlock,
    });

    const aliceRailgunAccount = await createRailgunAccount({
      credential: { type: 'mnemonic', mnemonic: 'test test test test test test test test test test test junk', accountIndex: 0 },
      indexer,
      storage: createEmptyStorageLayer(),
    });

    const bobRailgunAccount = await createRailgunAccount({
      credential: { type: 'mnemonic', mnemonic: 'test test test test test test test test test test junk junk', accountIndex: 0 },
      indexer,
      storage: createEmptyStorageLayer(),
    });

    const aliceRailgunAddress = await aliceRailgunAccount.getRailgunAddress();
    const bobRailgunAddress = await bobRailgunAccount.getRailgunAddress();

    console.log(`Alice Railgun address: ${aliceRailgunAddress}`);
    console.log(`Bob Railgun address: ${bobRailgunAddress}`);


    // Initialize indexer with cached Merkle trees and sync to latest
    console.log('\nLoading cached state into indexer...');
    // await indexer.loadState({ merkleTrees: cachedMerkleTrees, latestSyncedBlock: forkBlock });
    await indexer.sync!({ logProgress: true });
    console.log('Cached state loaded');

    await anvil.mine(3);

    // Step 2: Get initial balances
    console.log('\nStep 2: Checking initial balances...');
    const aliceInitialEthBalance = await getETHBalance(
      provider,
      alice.address
    );
    const currentRootA = await aliceRailgunAccount.getLatestMerkleRoot();
    const currentRootB = await bobRailgunAccount.getLatestMerkleRoot();

    console.log(`Alice initial ETH balance: ${aliceInitialEthBalance.toString()}`);
    console.log(`Alice initial root: ${currentRootA}`);
    console.log(`Bob initial root: ${currentRootB}`);

    const startBlock = forkBlock;

    // Verify contracts exist on Anvil fork
    console.log('\n=== Verifying contracts exist on fork ===');
    const railgunCode = await provider.getCode(RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RAILGUN_ADDRESS!);
    const relayAdaptCode = await provider.getCode(RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS!);
    const wethCode = await provider.getCode(RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.WETH!);

    console.log(`RAILGUN contract code length: ${railgunCode.length} (${railgunCode === '0x' ? 'MISSING!' : 'exists'})`);
    console.log(`RELAY_ADAPT contract code length: ${relayAdaptCode.length} (${relayAdaptCode === '0x' ? 'MISSING!' : 'exists'})`);
    console.log(`WETH contract code length: ${wethCode.length} (${wethCode === '0x' ? 'MISSING!' : 'exists'})`);

    // Step 3: Shield ETH to Alice's Railgun account
    console.log('\nStep 3: Shielding ETH...');
    const shieldTx = await aliceRailgunAccount.shieldNative(VALUE_TO_SHIELD);

    console.log('Shield TX data:');
    console.log(`  to: ${shieldTx.to}`);
    console.log(`  value: ${shieldTx.value}`);
    console.log(`  data length: ${shieldTx.data.length}`);
    console.log(`  Expected RELAY_ADAPT: ${RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS}`);

    const shieldTxHash = await aliceSigner.sendTransaction({
      ...shieldTx,
      gasLimit: BigInt(6000000),
    });

    console.log(`Shield tx submitted: ${shieldTxHash}`);

    // Mine a block to ensure transaction is included
    await anvil.mine(1);

    // Get receipt directly (anvil auto-mines)
    const receipt = await provider.getTransactionReceipt(shieldTxHash);

    console.log(`\nShield tx mined in block ${receipt?.blockNumber}`);
    console.log(`Receipt status: ${receipt?.status} (1 = success, 0 = failure)`);
    console.log(`Receipt has ${receipt?.logs?.length ?? 0} logs`);
    console.log(`Receipt gas used: ${receipt?.gasUsed}`);

    // Log ALL logs from receipt (unfiltered)
    if (receipt?.logs && receipt.logs.length > 0) {
      console.log('\nAll logs in receipt:');
      receipt.logs.forEach((log, idx) => {
        console.log(`  Log ${idx}: address=${log.address}, topics=${log.topics.length}`);
      });
    } else {
      console.log('\nWARNING: Receipt has NO logs!');
    }

    // Try getting logs without address filter
    const allLogsInBlock = await provider.getLogs({
      address: '',
      fromBlock: receipt?.blockNumber ?? 0,
      toBlock: receipt?.blockNumber ?? 0
    });

    console.log(`\nAll logs in block ${receipt?.blockNumber}: ${allLogsInBlock.length}`);

    // Try getting logs from RAILGUN_ADDRESS
    const railgunLogs = await provider.getLogs({
      address: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RAILGUN_ADDRESS!,
      fromBlock: receipt?.blockNumber ?? 0,
      toBlock: receipt?.blockNumber ?? 0
    });

    console.log(`Logs from RAILGUN_ADDRESS: ${railgunLogs.length}`);

    // Try getting logs from RELAY_ADAPT_ADDRESS
    const relayAdaptLogs = await provider.getLogs({
      address: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS!,
      fromBlock: receipt?.blockNumber ?? 0,
      toBlock: receipt?.blockNumber ?? 0
    });

    console.log(`Logs from RELAY_ADAPT_ADDRESS: ${relayAdaptLogs.length}`);

    if (receipt?.status === 0) {
      throw new Error('Shield transaction reverted');
    }

    // Mine a few more blocks to ensure finality
    await anvil.mine(3);

    // Step 4: Sync Alice's account with new logs (from start of fork to include all new txs)
    console.log('\nStep 4: Syncing Alice account with new logs...');

    // Use receipt block + mined blocks as the end range (ethers provider caches block numbers)
    const currentBlock = (receipt?.blockNumber ?? forkBlock) + 3;

    console.log(`Querying logs from block ${startBlock} to ${currentBlock}`);

    // Query from forkBlock (not forkBlock + 1) to capture any logs at the fork block
    await indexer.sync!({ fromBlock: startBlock, toBlock: currentBlock, logProgress: true });
    console.log('Accounts synced');
    const currentRootA2 = aliceRailgunAccount.getLatestMerkleRoot();

    console.log(`Alice new root: ${currentRootA2}`);

    // Check Alice's private balance
    const alicePrivateBalance = await aliceRailgunAccount.getBalance();

    console.log(`Alice private balance: ${alicePrivateBalance.toString()}`);
    expect(alicePrivateBalance).toBeGreaterThan(0n);
    expect(alicePrivateBalance).toBeLessThanOrEqual(VALUE_TO_SHIELD);

    // Step 5: Private transfer from Alice to Bob
    console.log('\nStep 5: Creating private transfer...');
    const weth = RAILGUN_CONFIG_BY_CHAIN_ID[chainId]?.WETH;
    const transferTx = await aliceRailgunAccount.transfer(
      weth,
      VALUE_TO_TRANSFER,
      bobRailgunAddress
    );

    console.log('Private transfer tx prepared');

    const transferTxHash = await aliceSigner.sendTransaction({
      ...transferTx,
      gasLimit: BigInt(6000000),
    });

    console.log(`Private transfer tx submitted: ${transferTxHash}`);

    // Mine a block to ensure transaction is included
    await anvil.mine(1);

    console.log('Private transfer tx mined');

    await anvil.mine(3);

    // Step 6: Sync both accounts with transfer logs
    console.log('\nStep 6: Syncing accounts after transfer...');
    const newBlock = await provider.getBlockNumber();

    await indexer.sync!({ toBlock: newBlock, logProgress: true });

    const aliceRoot = aliceRailgunAccount.getLatestMerkleRoot();

    console.log(`Root after transfer: ${aliceRoot}`);
    expect(aliceRoot).not.toEqual(currentRootA2);

    const aliceBalanceAfterTransfer = await aliceRailgunAccount.getBalance();
    const bobPrivateBalance = await bobRailgunAccount.getBalance();

    console.log(`Alice balance after transfer: ${aliceBalanceAfterTransfer.toString()}`);
    console.log(`Bob private balance: ${bobPrivateBalance.toString()}`);

    expect(bobPrivateBalance).toBeGreaterThan(0n);
    expect(aliceBalanceAfterTransfer).toBeLessThan(alicePrivateBalance);

    await anvil.mine(3);

    // Step 7: Bob unshields to charlie's public address
    console.log('\nStep 7: Unshielding from Bob account...');

    const wethContract = new Contract(weth, ["function balanceOf(address) external view returns (uint256)"], await anvil.getProvider());
    const charlieBalanceWETHBeforeUnshield = await wethContract.balanceOf(charlie.address);

    console.log(`Charlie's WETH balance before unshield: ${charlieBalanceWETHBeforeUnshield.toString()} ${formatEther(charlieBalanceWETHBeforeUnshield)}`);

    const unshieldAmount = bobPrivateBalance;
    const unshieldTx = await bobRailgunAccount.unshield(
      weth,
      unshieldAmount,
      charlie.address as `0x${string}`
    );

    console.log('Unshield tx prepared ', unshieldTx);

    await fundAccountWithETH(anvil, bob.address, BigInt('2000000000000000000')); // Fund for gas 2 ETH
    const unshieldTxHash = await bobSigner.sendTransaction({
      ...unshieldTx,
      gasLimit: BigInt(6000000),
    });

    console.log(`Unshield tx submitted: ${unshieldTxHash}`);

    // Mine a block to ensure transaction is included
    await anvil.mine(1);

    console.log('Unshield tx mined');
    const unshieldReceipt = await provider.getTransactionReceipt(unshieldTxHash);

    console.log('Unshield tx receipt: ', unshieldReceipt);

    await anvil.mine(3);

    const charlieBalanceWETHAfterUnshield = await wethContract.balanceOf(charlie.address);

    console.log(`Charlie's WETH balance after unshield: ${charlieBalanceWETHAfterUnshield.toString()} ${formatEther(charlieBalanceWETHAfterUnshield)}`);


    expect(charlieBalanceWETHAfterUnshield).toBeGreaterThan(
      charlieBalanceWETHBeforeUnshield
    );

    console.log('\n=== Test completed successfully ===\n');
  }, 180000); // 3 minute timeout for the full flow
});
