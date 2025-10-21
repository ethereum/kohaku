import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RailgunAccount, RailgunLog } from '../../src/account-utils';
import { TEST_ACCOUNTS } from '../utils/test-accounts';
import { fundAccountWithETH, getETHBalance } from '../utils/test-helpers';
import { ViemProviderAdapter, ViemSignerAdapter } from '../../src/provider';
import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { loadOrCreateCache } from '../utils/cache';
import { getAllLogs } from '../../src/account-utils/indexer';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import { formatEther, getContract } from 'viem';
import { getWalletNodeFromKey } from '../../src/account-utils/helpers';

// Helper to get environment variable with fallback
function getEnv(key: string, fallback: string): string {
  if (typeof process.env[key] === 'string' && process.env[key]) {
    return process.env[key] as string;
  }
  return fallback;
}

describe('Railgun E2E Flow (Viem)', () => {
  let anvil: AnvilInstance;
  let provider: ViemProviderAdapter;
  let publicClient: PublicClient;
  let aliceWalletClient: WalletClient;
  let bobWalletClient: WalletClient;
  let charlieAddress: `0x${string}`;
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
      port: 8546, // Different port from Ethers test
      chainId: 11155111,
      forkBlockNumber: forkBlock,
    });

    await anvil.start();

    // Create Viem clients
    publicClient = createPublicClient({
      transport: http(anvil.rpcUrl),
    });

    const aliceAccount = privateKeyToAccount(TEST_ACCOUNTS.alice.privateKey as `0x${string}`);
    const bobAccount = privateKeyToAccount(TEST_ACCOUNTS.bob.privateKey as `0x${string}`);
    charlieAddress = TEST_ACCOUNTS.charlie.address as `0x${string}`;

    aliceWalletClient = createWalletClient({
      account: aliceAccount,
      transport: http(anvil.rpcUrl),
    });

    bobWalletClient = createWalletClient({
      account: bobAccount,
      transport: http(anvil.rpcUrl),
    });

    provider = new ViemProviderAdapter(publicClient);

    // Load or create cache for this fork block (this is the slow part on first run)
    console.log(`\nLoading cache for fork block ${forkBlock}...`);
    const cache = await loadOrCreateCache(provider, chainId, forkBlock);
    cachedLogs = cache.logs;
    cachedMerkleTrees = cache.merkleTrees;
    console.log(`Cache loaded: ${cachedLogs.length} logs, ${cachedMerkleTrees.length} trees\n`);

    // Fund alice with ETH
    await fundAccountWithETH(anvil, aliceAccount.address, BigInt('10000000000000000000')); // 10 ETH
    console.log(`Funded ${aliceAccount.address} with 10 ETH`);
  }, 300000); // 5 minute timeout for cache creation on first run

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
      console.log('Anvil stopped');
    }
  });

  it('should complete full shield -> transfer -> unshield flow', async () => {
    console.log('\n=== Starting Railgun E2E Test (Viem) ===\n');

    // Step 1: Create two Railgun accounts and load cached state
    console.log('Step 1: Creating Railgun accounts...');

    // Create accounts using the constructor with Viem signer adapters
    const aliceSpendingNode = getWalletNodeFromKey(TEST_ACCOUNTS.alice.privateKey);
    const aliceViewingNode = getWalletNodeFromKey(TEST_ACCOUNTS.alice.privateKey);
    const aliceSigner = new ViemSignerAdapter(aliceWalletClient);
    const aliceRailgunAccount = new RailgunAccount(chainId, aliceSpendingNode, aliceViewingNode, aliceSigner);

    const bobSpendingNode = getWalletNodeFromKey(TEST_ACCOUNTS.bob.privateKey);
    const bobViewingNode = getWalletNodeFromKey(TEST_ACCOUNTS.bob.privateKey);
    const bobSigner = new ViemSignerAdapter(bobWalletClient);
    const bobRailgunAccount = new RailgunAccount(chainId, bobSpendingNode, bobViewingNode, bobSigner);

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
      aliceWalletClient.account!.address
    );
    const currentRootA = await aliceRailgunAccount.getLatestMerkleRoot();
    console.log(`Alice initial ETH balance: ${aliceInitialEthBalance.toString()}`);
    console.log(`Alice initial root: ${currentRootA}`);

    const startBlock = await provider.getBlockNumber();

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
    const shieldTx = await aliceRailgunAccount.createNativeShieldTx(VALUE_TO_SHIELD);
    console.log('Shield TX data:');
    console.log(`  to: ${shieldTx.to}`);
    console.log(`  value: ${shieldTx.value}`);
    console.log(`  data length: ${shieldTx.data.length}`);
    console.log(`  Expected RELAY_ADAPT: ${RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS}`);

    const shieldTxHash = await aliceRailgunAccount.submitTx(shieldTx, aliceSigner);
    console.log(`Shield tx submitted: ${shieldTxHash}`);

    // Wait for tx to be mined and get receipt
    await provider.waitForTransaction(shieldTxHash);
    const receipt = await provider.getTransactionReceipt(shieldTxHash);
    console.log(`\nShield tx mined in block ${receipt?.blockNumber}`);
    console.log(`Receipt status: ${receipt?.status} (1 = success, 0 = failure)`);
    console.log(`Receipt has ${receipt?.logs?.length ?? 0} logs`);
    console.log(`Receipt gas used: ${receipt?.gasUsed}`);

    if (receipt?.status === 0) {
      throw new Error('Shield transaction reverted');
    }

    // Mine a few more blocks to ensure finality
    await anvil.mine(3);

    // Step 4: Sync Alice's account with new logs (from start of fork to include all new txs)
    console.log('\nStep 4: Syncing Alice account with new logs...');
    const currentBlock = await provider.getBlockNumber();
    console.log(`Querying logs from block ${startBlock} to ${currentBlock}`);

    // Query from forkBlock (not forkBlock + 1) to capture any logs at the fork block
    const newLogs = await getAllLogs(provider, chainId, startBlock, currentBlock);
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

    const transferTxHash = await aliceRailgunAccount.submitTx(transferTx, aliceSigner);
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

    const wethContract = getContract({
      address: weth as `0x${string}`,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
      client: publicClient,
    });
    const charlieBalanceWETHBeforeUnshield = await wethContract.read.balanceOf([charlieAddress]);
    console.log(`Charlie's WETH balance before unshield: ${charlieBalanceWETHBeforeUnshield.toString()} ${formatEther(charlieBalanceWETHBeforeUnshield)}`);

    const unshieldAmount = bobPrivateBalance;
    const unshieldTx = await bobRailgunAccount.createUnshieldTx(
      weth,
      unshieldAmount,
      charlieAddress
    );
    console.log('Unshield tx prepared');

    await fundAccountWithETH(anvil, bobWalletClient.account!.address, BigInt('2000000000000000000')); // Fund for gas 2 ETH
    const unshieldTxHash = await bobRailgunAccount.submitTx(unshieldTx, bobSigner);
    console.log(`Unshield tx submitted: ${unshieldTxHash}`);

    await provider.waitForTransaction(unshieldTxHash);
    console.log('Unshield tx mined');
    const unshieldReceipt = await provider.getTransactionReceipt(unshieldTxHash);
    console.log('Unshield tx receipt: ', unshieldReceipt);

    await anvil.mine(3);

    const charlieBalanceWETHAfterUnshield = await wethContract.read.balanceOf([charlieAddress]);
    console.log(`Charlie's WETH balance after unshield: ${charlieBalanceWETHAfterUnshield.toString()} ${formatEther(charlieBalanceWETHAfterUnshield)}`);


    expect(charlieBalanceWETHAfterUnshield).toBeGreaterThan(
      charlieBalanceWETHBeforeUnshield
    );

    console.log('\n=== Test completed successfully (Viem) ===\n');
  }, 180000); // 3 minute timeout for the full flow
});
