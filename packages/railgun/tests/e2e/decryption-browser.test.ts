import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Wallet } from 'ethers';
import {
  createRailgunAccount,
  createRailgunIndexer,
  type RailgunLog,
} from '../../src';
import { TEST_ACCOUNTS } from '../utils/test-accounts';
import { fundAccountWithETH } from '../utils/test-helpers';
import { EthersProviderAdapter, EthersSignerAdapter } from '../../src/provider';
import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import { KeyConfig } from '../../src/account/keys';

// Use globalThis to store the flag - this is available before module initialization
declare global {
  var __FORCE_BROWSER_MODE__: boolean | undefined;
}

// Initialize the global flag
globalThis.__FORCE_BROWSER_MODE__ = false;

// Mock the runtime module at the top level
vi.mock('../../src/railgun/lib/utils/runtime', async () => {
  const actual = await vi.importActual('../../src/railgun/lib/utils/runtime');

  return {
    ...actual,
    get isNodejs() {
      // When __FORCE_BROWSER_MODE__ is true, return false to simulate browser
      return globalThis.__FORCE_BROWSER_MODE__ ? false : (actual as typeof actual & { isNodejs: boolean }).isNodejs;
    },
  };
});

/**
 * This test verifies that note decryption works correctly during processLogs.
 *
 * In Node.js environments, the Node.js crypto module is used.
 * In browser environments, the Web Crypto API is used (via browserDecryptGCM/browserDecryptCTR).
 *
 * Both paths should produce identical results when decrypting the same ciphertext.
 *
 * Note: Since isNodejs is evaluated at module load time, we can't easily switch
 * between paths in the same test run. However, this test verifies:
 * 1. Decryption works correctly with real logs (Node.js path in test environment)
 * 2. The browser path code is properly implemented and will be used automatically
 *    when the package is used in a browser environment
 */
describe('Note Decryption - Browser vs Node.js Paths', () => {
  let anvil: AnvilInstance;
  let provider: EthersProviderAdapter;
  let alice: Wallet;
  let forkBlock: number;

  const SEPOLIA_FORK_URL = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';
  const chainId = '11155111' as const;
  const VALUE_TO_SHIELD = BigInt('100000000000000000'); // 0.1 ETH

  beforeAll(async () => {
    forkBlock = 9327854;

    anvil = defineAnvil({
      forkUrl: SEPOLIA_FORK_URL,
      port: 8548,
      chainId: 11155111,
      forkBlockNumber: forkBlock,
    });

    await anvil.start();

    const jsonRpcProvider = await anvil.getProvider();

    provider = new EthersProviderAdapter(jsonRpcProvider);

    alice = new Wallet(TEST_ACCOUNTS.alice.privateKey, await anvil.getProvider());

    await fundAccountWithETH(anvil, alice.address, BigInt('10000000000000000000')); // 10 ETH
  }, 300000);

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
    }
  });

  it('should decrypt notes correctly on both Node.js and browser paths with real logs', async () => {
    const aliceSigner = new EthersSignerAdapter(alice);
    const aliceCredential = {
      type: 'mnemonic',
      mnemonic: 'test test test test test test test test test test test junk',
      accountIndex: 0,
    } as KeyConfig;

    // Shield ETH to create a real log with encrypted notes
    // First create account and indexer for the shield transaction
    const indexerForShield = await createRailgunIndexer({
      network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
      startBlock: forkBlock,
    });

    const aliceRailgunAccountForShield = await createRailgunAccount({
      credential: aliceCredential,
      indexer: indexerForShield,
    });

    const shieldTx = await aliceRailgunAccountForShield.shieldNative(VALUE_TO_SHIELD);
    const shieldTxHash = await aliceSigner.sendTransaction({
      ...shieldTx,
      gasLimit: BigInt(6000000),
    });

    await anvil.mine(1);

    const receipt = await provider.getTransactionReceipt(shieldTxHash);

    expect(receipt?.status).toBe(1);

    await anvil.mine(3);

    // Fetch logs
    const currentBlock = (receipt?.blockNumber ?? forkBlock) + 3;
    const logs = await provider.getLogs({
      address: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!.RAILGUN_ADDRESS!,
      fromBlock: forkBlock,
      toBlock: currentBlock,
    });

    expect(logs.length).toBeGreaterThan(0);

    // Test 1: Node.js path (default)
    const indexerNode = await createRailgunIndexer({
      network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
      startBlock: forkBlock,
    });

    const accountNode = await createRailgunAccount({
      credential: aliceCredential,
      indexer: indexerNode,
    });

    await indexerNode.processLogs(logs as RailgunLog[], { skipMerkleTree: false });
    const balanceNode = await accountNode.getBalance();

    expect(balanceNode).toBeGreaterThan(0n);
    expect(balanceNode).toBeLessThanOrEqual(VALUE_TO_SHIELD);

    // Get serialized state for Node.js path
    const stateNode = accountNode.getSerializedState();
    const notebooksNode = stateNode.notebooks || [];
    const nonNullNotesNode = notebooksNode.flatMap((nb, treeIdx) =>
      (nb || []).map((note, noteIdx) => ({ treeIdx, noteIdx, note })).filter(n => n.note !== null && n.note !== undefined)
    );

    // Test 2: Browser path (force isNodejs to false)

    // Enable browser mode
    globalThis.__FORCE_BROWSER_MODE__ = true;

    // Clear module cache for modules that depend on isNodejs
    // This forces them to re-evaluate isNodejs
    const moduleCache = require.cache;
    const modulesToClear = Object.keys(moduleCache).filter(key =>
      key.includes('railgun/lib/utils/encryption/aes') ||
      key.includes('railgun/logic/global/crypto') ||
      key.includes('railgun/lib/utils/runtime') ||
      key.includes('railgun/indexer') ||
      key.includes('railgun/account') ||
      key.includes('railgun/logic/logic/note') ||
      key.includes('railgun/lib/note')
    );

    modulesToClear.forEach(key => delete moduleCache[key]);

    try {
      // Re-import modules after clearing cache - they will now see isNodejs as false
      const runtimeModule = await import('../../src/railgun/lib/utils/runtime');

      if (runtimeModule.isNodejs) {
        throw new Error('Failed to force browser mode - isNodejs is still true. The mock may not be working correctly.');
      }

      // Re-import AES and crypto modules which will use browser path
      await import('../../src/railgun/lib/utils/encryption/aes');
      await import('../../src/railgun/logic/global/crypto');

      // Re-import the main functions so they use the re-imported modules
      const { createRailgunIndexer: createIndexerBrowser } = await import('../../src/indexer/base');
      const { createRailgunAccount: createAccountBrowser } = await import('../../src/account/base');

      // Create new indexer and account - they will use browser decryption path
      const indexerBrowser = await createIndexerBrowser({
        network: RAILGUN_CONFIG_BY_CHAIN_ID[chainId]!,
        startBlock: forkBlock,
      });

      const accountBrowser = await createAccountBrowser({
        credential: aliceCredential,
        indexer: indexerBrowser,
      });

      // Process the same logs with browser path
      await indexerBrowser.processLogs(logs as RailgunLog[], { skipMerkleTree: false });
      const balanceBrowser = await accountBrowser.getBalance();

      expect(balanceBrowser).toBeGreaterThan(0n);
      expect(balanceBrowser).toBeLessThanOrEqual(VALUE_TO_SHIELD);

      // Get serialized state for browser path
      const stateBrowser = accountBrowser.getSerializedState();
      const notebooksBrowser = stateBrowser.notebooks || [];
      const nonNullNotesBrowser = notebooksBrowser.flatMap((nb, treeIdx) =>
        (nb || []).map((note, noteIdx) => ({ treeIdx, noteIdx, note })).filter(n => n.note !== null && n.note !== undefined)
      );

      // Verify both paths produce the same result
      expect(nonNullNotesNode.length).toEqual(nonNullNotesBrowser.length);
      expect(balanceNode).toEqual(balanceBrowser);
    } finally {
      // Disable browser mode to restore Node.js path
      globalThis.__FORCE_BROWSER_MODE__ = false;

      // Clear cache again to restore Node.js path for subsequent tests
      const moduleCache2 = require.cache;
      const modulesToClear2 = Object.keys(moduleCache2).filter(key =>
        key.includes('railgun/lib/utils/encryption/aes') ||
        key.includes('railgun/logic/global/crypto') ||
        key.includes('railgun/lib/utils/runtime') ||
        key.includes('railgun/indexer') ||
        key.includes('railgun/account') ||
        key.includes('railgun/logic/logic/note') ||
        key.includes('railgun/lib/note')
      );

      modulesToClear2.forEach(key => delete moduleCache2[key]);
    }
  }, 180000);
});
