import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Wallet } from 'ethers';
import { RailgunAccount, RailgunLog } from '../../src/account-utils';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import { getTestWallet } from '../utils/test-accounts';
import { fundAccountWithETH, getETHBalance } from '../utils/test-helpers';
import { EthersProviderAdapter } from '../../src/provider';
import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { loadOrCreateCache } from '../utils/cache';
import { getAllLogs } from '../../src/account-utils/indexer';

// Helper to get environment variable with fallback
function getEnv(key: string, fallback: string): string {
  if (typeof process.env[key] === 'string' && process.env[key]) {
    return process.env[key] as string;
  }
  return fallback;
}

describe('Railgun E2E Flow', () => {
  let anvil: AnvilInstance;
  let provider: EthersProviderAdapter;
  let alice: Wallet;
  let bob: Wallet;
  let cachedLogs: RailgunLog[];
  let cachedMerkleTrees: { tree: string[][]; nullifiers: string[] }[];
  let forkBlock: number;

  const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://rpc.sepolia.org');

  const chainId = '11155111' as const;
  const VALUE_TO_SHIELD = BigInt('10000000000000000'); // 0.01 ETH
  const VALUE_TO_TRANSFER = BigInt('1000000000000000'); // 0.001 ETH

  beforeAll(async () => {
    forkBlock = 5858117;

    // Setup anvil forking Sepolia
    anvil = defineAnvil({
      forkUrl: SEPOLIA_FORK_URL,
      port: 8545,
      chainId: 11155111,
      forkBlockNumber: forkBlock,
    });

    await anvil.start();

    const jsonRpcProvider = await anvil.getProvider();
    provider = new EthersProviderAdapter(jsonRpcProvider);

    // Load or create cache for this fork block (this is the slow part on first run)
    console.log(`\nLoading cache for fork block ${forkBlock}...`);
    const cache = await loadOrCreateCache(provider, chainId, forkBlock);
    cachedLogs = cache.logs;
    cachedMerkleTrees = cache.merkleTrees;
    console.log(`Cache loaded: ${cachedLogs.length} logs, ${cachedMerkleTrees.length} trees\n`);

    // Setup test accounts
    alice = getTestWallet('alice');
    bob = getTestWallet('bob');

    // Fund alice with ETH
    await fundAccountWithETH(anvil, alice.address, BigInt('10000000000000000000')); // 10 ETH
    console.log(`Funded ${alice.address} with 10 ETH`);
  }, 120000);

  afterAll(async () => {
    if (anvil) {
      console.log('Stopping Anvil...');
      await anvil.stop();
      console.log('Anvil stopped');
    }
  });

  it('should complete full shield -> transfer -> unshield flow', async () => {
    console.log('\n=== Starting Railgun E2E Test ===\n');

    // Step 1: Create two Railgun accounts and load cached state
    console.log('Step 1: Creating Railgun accounts...');
    const aliceRailgunAccount = RailgunAccount.fromPrivateKeys(
      alice.privateKey,
      alice.privateKey,
      chainId,
      alice.privateKey
    );
    const bobRailgunAccount = RailgunAccount.fromPrivateKeys(
      bob.privateKey,
      bob.privateKey,
      chainId,
      bob.privateKey
    );

    const aliceRailgunAddress = await aliceRailgunAccount.getRailgunAddress();
    const bobRailgunAddress = await bobRailgunAccount.getRailgunAddress();
    console.log(`Alice Railgun address: ${aliceRailgunAddress}`);
    console.log(`Bob Railgun address: ${bobRailgunAddress}`);

    // Load cached merkle trees and sync with cached logs
    console.log('\nLoading cached state...');
    await aliceRailgunAccount.loadCachedMerkleTrees(cachedMerkleTrees);
    await bobRailgunAccount.loadCachedMerkleTrees(cachedMerkleTrees);
    await aliceRailgunAccount.syncWithLogs(cachedLogs, true);
    await bobRailgunAccount.syncWithLogs(cachedLogs, true);
    console.log('Cached state loaded');

    // Step 2: Get initial balances
    console.log('\nStep 2: Checking initial balances...');
    const aliceInitialEthBalance = await getETHBalance(
      await anvil.getProvider(),
      alice.address
    );
    console.log(`Alice initial ETH balance: ${aliceInitialEthBalance.toString()}`);

    // Step 3: Shield ETH to Alice's Railgun account
    console.log('\nStep 3: Shielding ETH...');
    const shieldTx = await aliceRailgunAccount.createNativeShieldTx(VALUE_TO_SHIELD);
    console.log(`Shield tx data prepared: ${shieldTx.to}`);

    const aliceSigner = alice.connect(await anvil.getProvider());
    const shieldTxHash = await aliceRailgunAccount.submitTx(shieldTx, aliceSigner as Wallet);
    console.log(`Shield tx submitted: ${shieldTxHash}`);

    // Wait for tx to be mined
    const receipt = await (await anvil.getProvider()).waitForTransaction(shieldTxHash);
    console.log(`Shield tx mined in block ${receipt?.blockNumber}`);
    console.log(`Receipt status: ${receipt?.status} (1 = success, 0 = failure)`);
    console.log(`Receipt has ${receipt?.logs?.length ?? 0} logs`);

    if (receipt?.status === 0) {
      throw new Error('Shield transaction reverted');
    }

    if (!receipt?.logs || receipt.logs.length === 0) {
      console.warn('WARNING: Shield transaction succeeded but emitted no logs!');
      console.warn('This might indicate the transaction did not interact with the Railgun contract');
      console.warn(`Transaction hash: ${shieldTxHash}`);
      console.warn(`To address: ${shieldTx.to}`);
    }

    // Mine a few more blocks to ensure finality
    await anvil.mine(3);

    // Step 4: Sync Alice's account with new logs (from start of fork to include all new txs)
    console.log('\nStep 4: Syncing Alice account with new logs...');
    const currentBlock = await provider.getBlockNumber();
    console.log(`Querying logs from block ${forkBlock} to ${currentBlock}`);

    // Query from forkBlock (not forkBlock + 1) to capture any logs at the fork block
    const newLogs = await getAllLogs(provider, chainId, forkBlock, currentBlock);
    console.log(`Fetched ${newLogs.length} new logs (expected logs from block ${receipt?.blockNumber})`);

    await aliceRailgunAccount.syncWithLogs(newLogs);
    console.log('Alice account synced');

    // Check Alice's private balance
    const alicePrivateBalance = await aliceRailgunAccount.getBalance();
    console.log(`Alice private balance: ${alicePrivateBalance.toString()}`);
    expect(alicePrivateBalance).toBeGreaterThan(0n);
    expect(alicePrivateBalance).toBeLessThanOrEqual(VALUE_TO_SHIELD);

    // Step 5: Private transfer from Alice to Bob
    console.log('\nStep 5: Creating private transfer...');
    const weth = config.WETH;
    const transferTx = await aliceRailgunAccount.createPrivateTransferTx(
      weth,
      VALUE_TO_TRANSFER,
      bobRailgunAddress
    );
    console.log('Private transfer tx prepared');

    const transferTxHash = await aliceRailgunAccount.submitTx(transferTx, aliceSigner as Wallet);
    console.log(`Private transfer tx submitted: ${transferTxHash}`);

    await (await anvil.getProvider()).waitForTransaction(transferTxHash);
    console.log('Private transfer tx mined');

    await anvil.mine(3);

    // Step 6: Sync both accounts with transfer logs
    console.log('\nStep 6: Syncing accounts after transfer...');
    const newBlock = await provider.getBlockNumber();
    const transferLogs = await getAllLogs(provider, chainId, currentBlock, newBlock);
    console.log(`Fetched ${transferLogs.length} transfer logs`);

    await aliceRailgunAccount.syncWithLogs(transferLogs);
    await bobRailgunAccount.syncWithLogs(newLogs.concat(transferLogs));

    const aliceBalanceAfterTransfer = await aliceRailgunAccount.getBalance();
    const bobPrivateBalance = await bobRailgunAccount.getBalance();
    console.log(`Alice balance after transfer: ${aliceBalanceAfterTransfer.toString()}`);
    console.log(`Bob private balance: ${bobPrivateBalance.toString()}`);

    expect(bobPrivateBalance).toBeGreaterThan(0n);
    expect(aliceBalanceAfterTransfer).toBeLessThan(alicePrivateBalance);

    // Step 7: Bob unshields to his public address
    console.log('\nStep 7: Unshielding from Bob account...');
    const bobBalanceBeforeUnshield = await getETHBalance(
      await anvil.getProvider(),
      bob.address
    );
    console.log(`Bob ETH balance before unshield: ${bobBalanceBeforeUnshield.toString()}`);

    const unshieldAmount = bobPrivateBalance / 2n; // Unshield half
    const unshieldTx = await bobRailgunAccount.createNativeUnshieldTx(
      unshieldAmount,
      bob.address
    );
    console.log('Unshield tx prepared');

    await fundAccountWithETH(anvil, bob.address, BigInt('1000000000000000000')); // Fund for gas
    const bobSigner = bob.connect(await anvil.getProvider());
    const unshieldTxHash = await bobRailgunAccount.submitTx(unshieldTx, bobSigner as Wallet);
    console.log(`Unshield tx submitted: ${unshieldTxHash}`);

    await (await anvil.getProvider()).waitForTransaction(unshieldTxHash);
    console.log('Unshield tx mined');

    await anvil.mine(3);

    // Check Bob's public balance increased
    const bobBalanceAfterUnshield = await getETHBalance(
      await anvil.getProvider(),
      bob.address
    );
    console.log(`Bob ETH balance after unshield: ${bobBalanceAfterUnshield.toString()}`);

    // Bob should have received ETH (accounting for gas costs, so we check it increased by at least 80% of unshielded amount)
    expect(bobBalanceAfterUnshield).toBeGreaterThan(
      bobBalanceBeforeUnshield + (unshieldAmount * 8n / 10n)
    );

    console.log('\n=== Test completed successfully ===\n');
  }, 180000); // 3 minute timeout for the full flow

  it('should handle shield and immediate unshield', async () => {
    console.log('\n=== Testing Shield and Unshield ===\n');

    const testAccount = RailgunAccount.fromPrivateKeys(
      alice.privateKey,
      alice.privateKey,
      chainId,
      alice.privateKey
    );

    // Load cached state
    console.log('Loading cached state...');
    await testAccount.loadCachedMerkleTrees(cachedMerkleTrees);
    await testAccount.syncWithLogs(cachedLogs, true);
    console.log('Cached state loaded');

    const shieldValue = BigInt('5000000000000000'); // 0.005 ETH

    // Shield
    console.log('Shielding ETH...');
    const shieldTx = await testAccount.createNativeShieldTx(shieldValue);
    const aliceSigner = alice.connect(await anvil.getProvider());
    const txHash = await testAccount.submitTx(shieldTx, aliceSigner as Wallet);
    await (await anvil.getProvider()).waitForTransaction(txHash);
    await anvil.mine(2);

    // Sync with new logs
    console.log('Syncing account...');
    const currentBlock = await provider.getBlockNumber();
    const newLogs = await getAllLogs(provider, chainId, forkBlock, currentBlock);
    await testAccount.syncWithLogs(newLogs);

    const privateBalance = await testAccount.getBalance();
    console.log(`Private balance after shield: ${privateBalance.toString()}`);
    expect(privateBalance).toBeGreaterThan(0n);

    // Unshield everything
    console.log('Unshielding all...');
    const unshieldTx = await testAccount.createNativeUnshieldTx(
      privateBalance,
      alice.address
    );
    const unshieldTxHash = await testAccount.submitTx(unshieldTx, aliceSigner as Wallet);
    await (await anvil.getProvider()).waitForTransaction(unshieldTxHash);
    await anvil.mine(2);

    // Sync with unshield logs
    const newBlock = await provider.getBlockNumber();
    const unshieldLogs = await getAllLogs(provider, chainId, currentBlock, newBlock);
    await testAccount.syncWithLogs(unshieldLogs);

    const finalBalance = await testAccount.getBalance();
    console.log(`Final private balance: ${finalBalance.toString()}`);

    // Balance should be close to 0 (may have some dust)
    expect(finalBalance).toBeLessThan(BigInt('100000000000000')); // Less than 0.0001 ETH

    console.log('\n=== Shield/Unshield test completed ===\n');
  }, 180000);
});
