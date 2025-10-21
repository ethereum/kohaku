import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Wallet, Contract } from 'ethers';
import { RailgunAccount, RailgunLog } from '../../src/account-utils';
import { TEST_ACCOUNTS } from '../utils/test-accounts';
import { fundAccountWithETH, getETHBalance } from '../utils/test-helpers';
import { EthersProviderAdapter } from '../../src/provider';
import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { loadOrCreateCache } from '../utils/cache';
import { getAllLogs } from '../../src/account-utils/indexer';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import { formatEther } from 'viem';

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
  let charlie: Wallet;
  let cachedLogs: RailgunLog[];
  let cachedMerkleTrees: { tree: string[][]; nullifiers: string[] }[];
  let forkBlock: number;

  const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://rpc.sepolia.org');

  const chainId = '11155111' as const;
  const VALUE_TO_SHIELD = BigInt('100000000000000000'); // 0.1 ETH
  const VALUE_TO_TRANSFER = BigInt('50000000000000000'); // 0.05 ETH

  beforeAll(async () => {
    forkBlock = 9313278; // More recent block

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
    
    await anvil.mine(3);

    // Step 2: Get initial balances
    console.log('\nStep 2: Checking initial balances...');
    const aliceInitialEthBalance = await getETHBalance(
      provider,
      alice.address
    );
    const currentRootA = await aliceRailgunAccount.getLatestMerkleRoot();
    console.log(`Alice initial ETH balance: ${aliceInitialEthBalance.toString()}`);
    console.log(`Alice initial root: ${currentRootA}`);

    const starttBlock = await provider.getBlockNumber();

    // Verify contracts exist on Anvil fork
    console.log('\n=== Verifying contracts exist on fork ===');
    const underlyingProvider = provider.getProvider();
    const railgunCode = await underlyingProvider.getCode(RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RAILGUN_ADDRESS!);
    const relayAdaptCode = await underlyingProvider.getCode(RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS!);
    const wethCode = await underlyingProvider.getCode(RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.WETH!);
    console.log(`RAILGUN contract code length: ${railgunCode.length} (${railgunCode === '0x' ? 'MISSING!' : 'exists'})`);
    console.log(`RELAY_ADAPT contract code length: ${relayAdaptCode.length} (${relayAdaptCode === '0x' ? 'MISSING!' : 'exists'})`);
    console.log(`WETH contract code length: ${wethCode.length} (${wethCode === '0x' ? 'MISSING!' : 'exists'})`);

    // Step 3: Shield ETH to Alice's Railgun account
    console.log('\nStep 3: Shielding ETH...');
    const shieldTx = await aliceRailgunAccount.createNativeShieldTx(VALUE_TO_SHIELD);
    console.log('Shield TX data:');
    console.log(`  to: ${shieldTx.to}`);
    console.log(`  value: ${shieldTx.value}`);
    console.log(`  data length: ${shieldTx.data.length}`);
    console.log(`  Expected RELAY_ADAPT: ${RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS}`);

    const shieldTxHash = await aliceRailgunAccount.submitTx(shieldTx, alice);
    console.log(`Shield tx submitted: ${shieldTxHash}`);

    // Wait for tx to be mined and get receipt
    await provider.waitForTransaction(shieldTxHash);
    const receipt = await underlyingProvider.getTransactionReceipt(shieldTxHash);
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
    const allLogsInBlock = await underlyingProvider.getLogs({
      fromBlock: receipt?.blockNumber ?? 0,
      toBlock: receipt?.blockNumber ?? 0
    });
    console.log(`\nAll logs in block ${receipt?.blockNumber}: ${allLogsInBlock.length}`);

    // Try getting logs from RAILGUN_ADDRESS
    const railgunLogs = await underlyingProvider.getLogs({
      address: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RAILGUN_ADDRESS!,
      fromBlock: receipt?.blockNumber ?? 0,
      toBlock: receipt?.blockNumber ?? 0
    });
    console.log(`Logs from RAILGUN_ADDRESS: ${railgunLogs.length}`);

    // Try getting logs from RELAY_ADAPT_ADDRESS
    const relayAdaptLogs = await underlyingProvider.getLogs({
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
    const currentBlock = await provider.getBlockNumber();
    console.log(`Querying logs from block ${starttBlock} to ${currentBlock}`);

    // Query from forkBlock (not forkBlock + 1) to capture any logs at the fork block
    const newLogs = await getAllLogs(provider, chainId, starttBlock, currentBlock);
    console.log(`Fetched ${newLogs.length} new logs (expected logs from block ${receipt?.blockNumber})`);

    await aliceRailgunAccount.syncWithLogs(newLogs);
    console.log('Alice account synced');
    const currentRootA2 = await aliceRailgunAccount.getLatestMerkleRoot();
    console.log(`Alice new root: ${currentRootA2}`);

    // Check Alice's private balance
    const alicePrivateBalance = await aliceRailgunAccount.getBalance();
    console.log(`Alice private balance: ${alicePrivateBalance.toString()}`);
    expect(alicePrivateBalance).toBeGreaterThan(0n);
    expect(alicePrivateBalance).toBeLessThanOrEqual(VALUE_TO_SHIELD);

    // Step 5: Private transfer from Alice to Bob
    console.log('\nStep 5: Creating private transfer...');
    const weth = RAILGUN_CONFIG_BY_CHAIN_ID[chainId]?.WETH;
    const transferTx = await aliceRailgunAccount.createPrivateTransferTx(
      weth,
      VALUE_TO_TRANSFER,
      bobRailgunAddress
    );
    console.log('Private transfer tx prepared');

    const transferTxHash = await aliceRailgunAccount.submitTx(transferTx, alice);
    console.log(`Private transfer tx submitted: ${transferTxHash}`);

    await provider.waitForTransaction(transferTxHash);
    console.log('Private transfer tx mined');

    await anvil.mine(3);

    // Step 6: Sync both accounts with transfer logs
    console.log('\nStep 6: Syncing accounts after transfer...');
    const newBlock = await provider.getBlockNumber();
    const transferLogs = await getAllLogs(provider, chainId, currentBlock, newBlock);
    console.log(`Fetched ${transferLogs.length} transfer logs`);

    await aliceRailgunAccount.syncWithLogs(transferLogs);
    await bobRailgunAccount.syncWithLogs(newLogs.concat(transferLogs));

    const aliceRoot = await aliceRailgunAccount.getLatestMerkleRoot();
    const bobRoot = await bobRailgunAccount.getLatestMerkleRoot();
    console.log(`Alice root after transfer: ${aliceRoot}`);
    console.log(`Bob root after transfer: ${bobRoot}`);
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
    const unshieldTx = await bobRailgunAccount.createUnshieldTx(
      weth,
      unshieldAmount,
      charlie.address
    );
    console.log('Unshield tx prepared ', unshieldTx);

    await fundAccountWithETH(anvil, bob.address, BigInt('2000000000000000000')); // Fund for gas 2 ETH
    const unshieldTxHash = await bobRailgunAccount.submitTx(unshieldTx, bob);
    console.log(`Unshield tx submitted: ${unshieldTxHash}`);

    await provider.waitForTransaction(unshieldTxHash);
    console.log('Unshield tx mined');
    const unshieldReceipt = await underlyingProvider.getTransactionReceipt(unshieldTxHash);
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
