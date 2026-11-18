import { describe, expect, it, vi } from 'vitest';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { myDepositsBalanceSelector } from '../../src/state/selectors/balance.selector';
import {
  lastUpdateRootEventSelector,
  poolsLeavesSelector,
  poolsSelector,
  ragequitsSelector,
  withdrawalsSelector,
} from '../../src/state/selectors/slices.selectors';
import { storeFactory } from '../../src/state/store';
import { discoverUserSecretsThunk } from '../../src/state/thunks/discoverUserSecretsThunk';
import { syncThunk } from '../../src/state/thunks/syncThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const entrypoint = 900n as Address;
const pool = 1000n as Address;
const otherPool = 1001n as Address;
const asset = 2000n as Address;
const user = 3000n as Address;
const myPrecommitment = 77n;
const myLabel = 10n;

type ChainEvent = { blockNumber: bigint; transactionHash: bigint } & Record<string, unknown>;

interface Chain {
  head: bigint;
  finalized: bigint;
  entrypoint: Record<string, ChainEvent[]>;
  pool: Record<string, ChainEvent[]>;
}

// Block 100 registers the pool, block 105 holds the user's deposit (leaf 0).
const baseChain = (): Chain => ({
  head: 110n,
  finalized: 104n,
  entrypoint: {
    PoolRegistered: [{ pool, asset, scope: 1n, blockNumber: 100n, transactionHash: 0n }],
    PoolWindDown: [],
    RootUpdated: [],
    EntrypointDeposited: [
      { depositor: user, poolAddress: pool, commitment: 11n, blockNumber: 105n, transactionHash: 0n },
    ],
  },
  pool: {
    PoolDeposited: [
      { depositor: user, commitment: 11n, label: myLabel, value: 100n, precommitment: myPrecommitment, blockNumber: 105n, transactionHash: 0n },
    ],
    LeafInserted: [
      { index: 0n, commitment: 11n, root: 1n, blockNumber: 105n, transactionHash: 0n },
    ],
    Withdrawn: [],
    Ragequit: [],
  },
});

/** eth_getLogs over whatever `chain` holds when the scan runs. */
const chainDataService = (chain: Chain) => {
  const scan = (source: () => Record<string, ChainEvent[]>) =>
    vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock: bigint }) => {
      const inRange = (e: ChainEvent) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock;

      return {
        ...Object.fromEntries(events.map((name) => [name, (source()[name] ?? []).filter(inRange)])),
        fromBlock,
        toBlock,
      };
    });

  return {
    getBlockNumber: vi.fn(async () => chain.head),
    getFinalizedBlockNumber: vi.fn(async () => chain.finalized),
    getEntrypointEvents: scan(() => chain.entrypoint),
    getPoolEvents: scan(() => chain.pool),
    getAsset: vi.fn(async (address: Address) => ({ address, name: 'T', symbol: 'T', decimals: 18 })),
  };
};

const secretManager = {
  getDepositSecrets: async ({ depositIndex }: { depositIndex: number }) => ({
    nullifier: 1n,
    salt: 2n,
    precommitment: depositIndex === 0 ? myPrecommitment : 999n,
    nullifierHash: 5n,
  }),
  getSecrets: async () => ({ nullifier: 3n, salt: 4n, precommitment: 0n, nullifierHash: 6n }),
} as unknown as ISecretManager;

const setupStore = () => storeFactory({
  logLevel: 'off',
  devOptions: TEST_STORE_DEV_OPTIONS,
  entrypointInfo: { chainId: 1n, entrypointAddress: entrypoint, deploymentBlock: 100n },
});

const sync = async (store: ReturnType<typeof setupStore>, dataService: ReturnType<typeof chainDataService>) => {
  await store.dispatch(syncThunk({
    dataService: dataService as unknown as IDataService,
    aspService: {} as IAspService,
    verify: false,
    skipAsp: true,
  })).unwrap();
  await store.dispatch(discoverUserSecretsThunk({ secretManager })).unwrap();
};

const myBalance = (store: ReturnType<typeof setupStore>) =>
  myDepositsBalanceSelector(store.getState()).get(myPrecommitment)?.balance;

describe('syncThunk reorgs', () => {
  it('drops a ragequit that a reorg removed', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    chain.pool.Ragequit = [
      { ragequitter: user, commitment: 11n, label: myLabel, value: 100n, blockNumber: 108n, transactionHash: 0n },
    ];
    await sync(store, dataService);
    expect(myBalance(store)).toBe(0n);

    // Blocks 106-110 are replaced by a branch without the ragequit.
    chain.pool.Ragequit = [];
    chain.head = 112n;
    chain.finalized = 106n;
    await sync(store, dataService);

    expect(ragequitsSelector(store.getState()).size).toBe(0);
    expect(myBalance(store)).toBe(100n);
  });

  it('drops a withdrawal and its leaf that a reorg removed', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    chain.pool.Withdrawn = [
      { spentNullifier: 5n, commitment: 33n, value: 40n, blockNumber: 108n, transactionHash: 0n },
    ];
    chain.pool.LeafInserted!.push({ index: 1n, commitment: 33n, root: 2n, blockNumber: 108n, transactionHash: 0n });
    await sync(store, dataService);
    expect(myBalance(store)).toBe(60n);

    // The replacement branch puts someone else's deposit at leaf 1, at block 107.
    chain.pool.Withdrawn = [];
    chain.pool.LeafInserted = [
      chain.pool.LeafInserted![0]!,
      { index: 1n, commitment: 44n, root: 3n, blockNumber: 107n, transactionHash: 0n },
    ];
    chain.head = 112n;
    chain.finalized = 106n;
    await sync(store, dataService);

    expect(withdrawalsSelector(store.getState()).size).toBe(0);
    expect(myBalance(store)).toBe(100n);
    expect(poolsLeavesSelector(store.getState()).get(pool)?.get(1n)?.commitment).toBe(44n);
  });

  it('drops a pool registration and root update that a reorg removed', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);
    const rootUpdate = (root: bigint, blockNumber: bigint) =>
      ({ root, ipfsCID: `cid-${root}`, timestamp: 0n, blockNumber, transactionHash: 0n });

    chain.entrypoint.RootUpdated = [rootUpdate(1n, 103n), rootUpdate(2n, 109n)];
    chain.entrypoint.PoolRegistered!.push({ pool: otherPool, asset, scope: 2n, blockNumber: 109n, transactionHash: 0n });
    await sync(store, dataService);
    expect(poolsSelector(store.getState()).has(otherPool)).toBe(true);
    expect(lastUpdateRootEventSelector(store.getState())?.root).toBe(2n);

    chain.entrypoint.RootUpdated = [rootUpdate(1n, 103n)];
    chain.entrypoint.PoolRegistered!.pop();
    chain.head = 112n;
    chain.finalized = 106n;
    await sync(store, dataService);

    expect(poolsSelector(store.getState()).has(otherPool)).toBe(false);
    expect(lastUpdateRootEventSelector(store.getState())?.root).toBe(1n);
  });

  it('drops what a failed sync left behind once the chain reorgs', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    chain.pool.Ragequit = [
      { ragequitter: user, commitment: 11n, label: myLabel, value: 100n, blockNumber: 108n, transactionHash: 0n },
    ];
    dataService.getAsset.mockRejectedValueOnce(new Error('rpc down'));
    await expect(sync(store, dataService)).rejects.toThrow('rpc down');

    chain.pool.Ragequit = [];
    await sync(store, dataService);

    expect(ragequitsSelector(store.getState()).size).toBe(0);
    expect(myBalance(store)).toBe(100n);
  });

  it('rescans from the finalized block, not from the head', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    await sync(store, dataService);
    chain.head = 120n;
    chain.finalized = 115n;
    await sync(store, dataService);

    const fromBlocks = dataService.getPoolEvents.mock.calls.map(([{ fromBlock }]) => fromBlock);

    expect(fromBlocks).toEqual([100n, 104n]);
  });

  it('rewinds a state saved before the finalized cursor existed, once', async () => {
    const chain = baseChain();
    const dataService = chainDataService(chain);

    chain.pool.Ragequit = [
      { ragequitter: user, commitment: 11n, label: myLabel, value: 100n, blockNumber: 108n, transactionHash: 0n },
    ];
    chain.finalized = 110n;
    await sync(setupStore(), dataService);

    // What an older version saved: the ragequit, and its head with no finalized block.
    const saved = setupStore();

    await sync(saved, dataService);
    const store = storeFactory({
      logLevel: 'off',
      devOptions: TEST_STORE_DEV_OPTIONS,
      entrypointInfo: { chainId: 1n, entrypointAddress: entrypoint, deploymentBlock: 100n },
      initialState: { ...saved.getState(), sync: { lastSyncedBlock: saved.getState().sync.lastSyncedBlock } },
    });

    chain.pool.Ragequit = [];
    chain.head = 112n;
    chain.finalized = 106n;
    await sync(store, dataService);

    expect(ragequitsSelector(store.getState()).size).toBe(0);
    expect(myBalance(store)).toBe(100n);
    expect(BigInt(store.getState().sync.finalizedBlock!)).toBe(106n);
  });

  it('keeps a wind-down that is still on the chain', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    chain.entrypoint.PoolWindDown = [{ pool, blockNumber: 108n, transactionHash: 0n }];
    await sync(store, dataService);
    expect(poolsSelector(store.getState()).get(pool)?.woundDownAtBlock).toBe(108n);

    chain.head = 112n;
    chain.finalized = 106n;
    await sync(store, dataService);

    expect(poolsSelector(store.getState()).get(pool)?.woundDownAtBlock).toBe(108n);
  });

  it('records a wind-down of a pool registered in an earlier sync', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    chain.finalized = 110n;
    await sync(store, dataService);

    chain.entrypoint.PoolWindDown = [{ pool, blockNumber: 115n, transactionHash: 0n }];
    chain.head = 120n;
    chain.finalized = 120n;
    await sync(store, dataService);

    expect(poolsSelector(store.getState()).get(pool)?.woundDownAtBlock).toBe(115n);
  });

  it('never commits a finalized block past the scanned head', async () => {
    const chain = baseChain();
    const store = setupStore();
    const dataService = chainDataService(chain);

    // A load-balanced RPC whose finalized block comes from a node ahead of the head.
    chain.finalized = 115n;
    await sync(store, dataService);

    expect(store.getState().sync.finalizedBlock).toBe('0x6e');
  });
});
