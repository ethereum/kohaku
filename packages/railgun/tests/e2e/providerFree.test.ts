
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Wallet, Contract } from 'ethers';
import {
  createRailgunAccount,
  createRailgunIndexer,
  type CachedAccountStorage,
} from '../../src';
import { TEST_ACCOUNTS } from '../utils/test-accounts';
import { fundAccountWithETH, getETHBalance } from '../utils/test-helpers';
import { ethers, EthersSignerAdapter } from '@kohaku-eth/provider/ethers';
import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import { formatEther } from 'viem';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { KeyConfig } from '../../src/account/keys';
import { EthereumProvider, TxLog } from '@kohaku-eth/provider';

// Helper to get environment variable with fallback
function getEnv(key: string, fallback: string): string {
  if (typeof process.env[key] === 'string' && process.env[key]) {
    return process.env[key] as string;
  }

  return fallback;
}

// Load checkpoint file to initialize indexer state (demonstrates loading preloaded state)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCheckpointState(): Promise<{ merkleTrees: any; endBlock: number } | undefined> {
  const checkpointPath = './tests/utils/checkpoints/sepolia_public_checkpoint.json';

  if (!existsSync(checkpointPath)) {
    console.log('No checkpoint file found, starting fresh');

    return undefined;
  }

  const data = JSON.parse(await readFile(checkpointPath, 'utf8'));

  return {
    merkleTrees: data.merkleTrees || [],
    endBlock: data.endBlock || 0,
  };
}

// In-memory state (demonstrates serialization without file I/O)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let indexerState: { merkleTrees: any; endBlock: number } | undefined;
let aliceAccountState: CachedAccountStorage | undefined = undefined;
let bobAccountState: CachedAccountStorage | undefined = undefined;

// External log fetching (duplicated from sync.ts)
async function* getLogs(
  provider: EthereumProvider,
  network: typeof RAILGUN_CONFIG_BY_CHAIN_ID['11155111'],
  startBlock: number,
  endBlock: number
): AsyncGenerator<{ logs: TxLog[]; toBlock: number }> {
  const MAX_BATCH = 200;
  const MIN_BATCH = 1;
  const railgunAddress = network.RAILGUN_ADDRESS;
  let batch = Math.min(MAX_BATCH, Math.max(1, endBlock - startBlock + 1));
  let fromBlock = startBlock;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isRangeErr(e: any) {
    return (
      e?.error?.code === -32001 ||
      /Under the Free/.test(e['info']?.['responseBody'] || '') ||
      /failed to resolve block range/i.test(String(e?.error?.message || e?.message || e?.info?.responseBody || e?.toString() || ''))
    );
  }

  while (fromBlock <= endBlock) {
    const toBlock = Math.min(fromBlock + batch - 1, endBlock);

    try {
      console.log(`[getLogs]: fetching logs from block ${fromBlock} to ${toBlock}`);
      const startTime = Date.now();

      await new Promise(r => setTimeout(r, 400)); // light pacing
      const logs = await provider.getLogs({
        address: railgunAddress!,
        fromBlock,
        toBlock,
      });

      const duration = Date.now() - startTime;

      console.log(`[getLogs]: fetched ${logs.length} logs (duration: ${duration}ms)`);

      yield { logs, toBlock };

      fromBlock = toBlock + 1;                 // advance
      batch = Math.min(batch * 1.2, MAX_BATCH); // grow again after success
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (isRangeErr(e)) {
        console.log('[getLogs]: range error, retrying with smaller batch');

        if (batch > MIN_BATCH) {
          batch = Math.max(MIN_BATCH, Math.floor(batch / 2)); // shrink and retry same 'from'
          console.log(`[getLogs]: shrinking batch to ${batch}`);
          continue;
        }

        // single-block still fails: skip this block to move on
        fromBlock = toBlock + 1;
        continue;
      }

      console.log('[getLogs]: non range error', Object.keys(e));
      throw e; // non-range error -> surface it
    }
  }
}

async function fetchAndProcessLogs(
  provider: EthereumProvider,
  indexer: Awaited<ReturnType<typeof createRailgunIndexer>>,
  fromBlock: number,
  toBlock: number
) {
  const network = RAILGUN_CONFIG_BY_CHAIN_ID['11155111']!;
  const allLogs: TxLog[] = [];

  // Fetch all logs
  for await (const { logs } of getLogs(provider, network, fromBlock, toBlock)) {
    allLogs.push(...logs);
  }

  // Process all logs
  if (allLogs.length > 0) {
    console.log(`[fetchAndProcessLogs]: processing ${allLogs.length} logs`);
    await indexer.processLogs(allLogs, { skipMerkleTree: false });
  }
}

describe('Railgun E2E Flow (Provider-Free)', () => {
  let anvil: AnvilInstance;
  let provider: EthereumProvider;
  let alice: Wallet;
  let bob: Wallet;
  let charlie: Wallet;
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
      port: 8547, // Different port from other tests
      chainId: 11155111,
      forkBlockNumber: forkBlock,
    });

    await anvil.start();

    const jsonRpcProvider = await anvil.getProvider();

    provider = ethers(jsonRpcProvider);

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
    console.log('\n=== Starting Railgun E2E Test (Provider-Free) ===\n');

    // Load checkpoint state from file to initialize indexer (demonstrates loading preloaded state)
    indexerState = await loadCheckpointState();

    // Step 1: Create two Railgun accounts with external storage
    console.log('Step 1: Creating Railgun accounts...');
    const aliceSigner = new EthersSignerAdapter(alice);
    const bobSigner = new EthersSignerAdapter(bob);

    // Create indexer WITHOUT provider or storage, using preloaded state from checkpoint
    console.log(`Using indexer state: endBlock=${indexerState?.endBlock || 0}, trees=${indexerState?.merkleTrees.length || 0}`);

    let indexer = await createRailgunIndexer({
      network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
      // No provider - we'll fetch logs externally
      // No storage - using in-memory serialized state
      startBlock: indexerState?.endBlock || forkBlock,
      loadState: indexerState,
    });

    const aliceCredential = { type: 'mnemonic', mnemonic: 'test test test test test test test test test test test junk', accountIndex: 0 };
    const bobCredential = { type: 'mnemonic', mnemonic: 'test test test test test test test test test test test test', accountIndex: 0 };

    // Create accounts WITHOUT storage, using in-memory serialized state
    // This demonstrates serialization/deserialization without file I/O
    let aliceRailgunAccount = await createRailgunAccount({
      credential: aliceCredential as KeyConfig,
      indexer,
      // No storage - using in-memory serialized state
      loadState: aliceAccountState,
    });

    let bobRailgunAccount = await createRailgunAccount({
      credential: bobCredential as KeyConfig,
      indexer,
      // No storage - using in-memory serialized state
      loadState: bobAccountState,
    });

    const aliceRailgunAddress = await aliceRailgunAccount.getRailgunAddress();
    const bobRailgunAddress = await bobRailgunAccount.getRailgunAddress();

    console.log(`Alice Railgun address: ${aliceRailgunAddress}`);
    console.log(`Bob Railgun address: ${bobRailgunAddress}`);

    // Initialize indexer by fetching and processing logs up to fork block
    console.log('\nLoading cached state into indexer...');
    let currentEndBlock = indexerState?.endBlock || forkBlock;

    if (currentEndBlock < forkBlock) {
      console.log(`Syncing from block ${currentEndBlock} to ${forkBlock}`);
      await fetchAndProcessLogs(provider, indexer, currentEndBlock, forkBlock);

      // Serialize indexer state in-memory (demonstrates serialization capability)
      indexerState = indexer.getSerializedState();
      currentEndBlock = indexerState.endBlock;
    }

    // Ensure we start from at least forkBlock for subsequent syncs (to capture new transactions)
    currentEndBlock = Math.max(currentEndBlock, forkBlock);

    console.log('Cached state loaded');

    await anvil.mine(3);

    // Step 2: Get initial balances
    console.log('\nStep 2: Checking initial balances...');
    const aliceInitialEthBalance = await getETHBalance(
      provider,
      alice.address
    );
    const currentRootA = aliceRailgunAccount.getLatestMerkleRoot();
    const currentRootB = bobRailgunAccount.getLatestMerkleRoot();

    console.log(`Alice initial ETH balance: ${aliceInitialEthBalance.toString()}`);
    console.log(`Alice initial root: ${currentRootA}`);
    console.log(`Bob initial root: ${currentRootB}`);

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
      fromBlock: receipt?.blockNumber ?? 0n,
      toBlock: receipt?.blockNumber ?? 0n
    });

    console.log(`\nAll logs in block ${receipt?.blockNumber}: ${allLogsInBlock.length}`);

    // Try getting logs from RAILGUN_ADDRESS
    const railgunLogs = await provider.getLogs({
      address: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RAILGUN_ADDRESS!,
      fromBlock: receipt?.blockNumber ?? 0n,
      toBlock: receipt?.blockNumber ?? 0n
    });

    console.log(`Logs from RAILGUN_ADDRESS: ${railgunLogs.length}`);

    // Try getting logs from RELAY_ADAPT_ADDRESS
    const relayAdaptLogs = await provider.getLogs({
      address: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RELAY_ADAPT_ADDRESS!,
      fromBlock: receipt?.blockNumber ?? 0n,
      toBlock: receipt?.blockNumber ?? 0n
    });

    console.log(`Logs from RELAY_ADAPT_ADDRESS: ${relayAdaptLogs.length}`);

    if (receipt?.status === 0n) {
      throw new Error('Shield transaction reverted');
    }

    // Mine a few more blocks to ensure finality
    await anvil.mine(3);

    // Step 4: Fetch and process logs externally (from start of fork to include all new txs)
    console.log('\nStep 4: Fetching and processing logs externally...');

    // Use receipt block + mined blocks as the end range (ethers provider caches block numbers)
    const currentBlock = Number(receipt?.blockNumber ?? forkBlock) + 3;

    console.log(`Querying logs from block ${forkBlock} to ${currentBlock}`);

    // Fetch logs externally and process them (from forkBlock to capture all new transactions)
    await fetchAndProcessLogs(provider, indexer, forkBlock, currentBlock);

    // Serialize indexer and account states in-memory (demonstrates serialization capability)
    indexerState = indexer.getSerializedState();
    currentEndBlock = indexerState.endBlock;
    aliceAccountState = aliceRailgunAccount.getSerializedState();
    bobAccountState = bobRailgunAccount.getSerializedState();
    console.log('States serialized in-memory (demonstrates serialization without file I/O)');

    console.log('Accounts synced and state saved');
    // verify account reconstitution
    indexer = await createRailgunIndexer({
      network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
      startBlock: indexerState?.endBlock || forkBlock,
      loadState: indexerState,
    });
    aliceRailgunAccount = await createRailgunAccount({
      credential: aliceCredential as KeyConfig,
      indexer,
      loadState: aliceAccountState,
    });

    bobRailgunAccount = await createRailgunAccount({
      credential: bobCredential as KeyConfig,
      indexer,
      loadState: bobAccountState,
    });
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

    // Step 6: Fetch and process logs externally after transfer
    console.log('\nStep 6: Fetching and processing logs after transfer...');
    const newBlock = Number(await provider.getBlockNumber());

    await fetchAndProcessLogs(provider, indexer, currentEndBlock, newBlock);

    // Serialize indexer and account states in-memory
    indexerState = indexer.getSerializedState();
    currentEndBlock = indexerState.endBlock;
    aliceAccountState = aliceRailgunAccount.getSerializedState();
    bobAccountState = bobRailgunAccount.getSerializedState();

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

    // Fetch and process logs after unshield
    const finalBlock = Number(await provider.getBlockNumber());

    await fetchAndProcessLogs(provider, indexer, currentEndBlock, finalBlock);

    // Serialize final state in-memory (demonstrates serialization without file I/O)
    indexerState = indexer.getSerializedState();
    aliceAccountState = aliceRailgunAccount.getSerializedState();
    bobAccountState = bobRailgunAccount.getSerializedState();

    console.log('Final states serialized in-memory (demonstrates serialization capability)');

    const charlieBalanceWETHAfterUnshield = await wethContract.balanceOf(charlie.address);

    console.log(`Charlie's WETH balance after unshield: ${charlieBalanceWETHAfterUnshield.toString()} ${formatEther(charlieBalanceWETHAfterUnshield)}`);

    expect(charlieBalanceWETHAfterUnshield).toBeGreaterThan(
      charlieBalanceWETHBeforeUnshield
    );

    console.log('\n=== Test completed successfully ===\n');
  }, 180000); // 3 minute timeout for the full flow
});
