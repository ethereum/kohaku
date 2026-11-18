import { describe, expect, it, vi } from 'vitest';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { selectLastSyncedBlock } from '../../src/state/selectors/last-synced-block.selector';
import { storeFactory } from '../../src/state/store';
import { syncThunk } from '../../src/state/thunks/syncThunk';
import { computeMerkleTreeRoot } from '../../src/utils/proof.util';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const entrypoint = 900n as Address;
const pool = 1000n as Address;
const asset = 2000n as Address;
const user = 3000n as Address;

type ChainEvent = { blockNumber: bigint; transactionHash: bigint } & Record<string, unknown>;

const deposit = (commitment: bigint, blockNumber: bigint): ChainEvent => ({
  depositor: user, commitment, label: commitment, value: 1n, precommitment: commitment, blockNumber, transactionHash: 0n,
});
const leaf = (index: bigint, commitment: bigint, blockNumber: bigint): ChainEvent => ({
  index, commitment, root: 0n, blockNumber, transactionHash: 0n,
});

const entrypointEvents: Record<string, ChainEvent[]> = {
  PoolRegistered: [{ pool, asset, scope: 1n, blockNumber: 100n, transactionHash: 0n }],
  PoolWindDown: [],
  RootUpdated: [],
  EntrypointDeposited: [],
};
// Leaf 3 lands at block 130, after the sync head (120).
const poolEvents: Record<string, ChainEvent[]> = {
  PoolDeposited: [deposit(11n, 105n), deposit(22n, 108n), deposit(33n, 130n)],
  LeafInserted: [leaf(1n, 11n, 105n), leaf(2n, 22n, 108n), leaf(3n, 33n, 130n)],
  Withdrawn: [],
  Ragequit: [],
};

const HEAD = 120n;
const LATEST = 130n;

/**
 * A chain whose head lookup returns HEAD while its contract state is already at
 * LATEST. Pool root reads mirror the Pool's ring buffer: currentRoot() and every
 * root it held before, at the requested block (latest when none is given).
 */
const chainDataService = async ({ dropLeaves = [] as bigint[], heads = [HEAD] } = {}) => {
  let headCall = 0;
  const leavesAt = (block: bigint) => poolEvents.LeafInserted!
    .filter((e) => e.blockNumber <= block)
    .map((e) => e.commitment as bigint);
  const rootHistoryAt = async (block: bigint) => {
    const leaves = leavesAt(block);

    return Promise.all(leaves.map((_, i) => computeMerkleTreeRoot(leaves.slice(0, i + 1))));
  };

  const scan = (source: Record<string, ChainEvent[]>, drop: (name: string, e: ChainEvent) => boolean) =>
    vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock: bigint }) => ({
      ...Object.fromEntries(events.map((name) => [
        name,
        (source[name] ?? []).filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock && !drop(name, e)),
      ])),
      fromBlock,
      toBlock,
    }));

  return {
    getBlockNumber: vi.fn(async () => heads[Math.min(headCall++, heads.length - 1)]!),
    getEntrypointEvents: scan(entrypointEvents, () => false),
    // A source that silently leaves out some leaf-bearing events.
    getPoolEvents: scan(poolEvents, (name, e) => name === 'LeafInserted' && dropLeaves.includes(e.index as bigint)),
    getAsset: vi.fn(async (address: Address) => ({ address, name: 'T', symbol: 'T', decimals: 18 })),
    getPoolStateRoot: vi.fn(async (_pool: Address, blockNumber: bigint = LATEST) => (await rootHistoryAt(blockNumber)).at(-1) ?? 0n),
    getPoolCurrentRootIndex: vi.fn(async () => leavesAt(LATEST).length - 1),
    getPoolHistoricalRoot: vi.fn(async (_pool: Address, index: number) => (await rootHistoryAt(LATEST))[index] ?? 0n),
  };
};

const setupStore = () => storeFactory({
  logLevel: 'off',
  devOptions: TEST_STORE_DEV_OPTIONS,
  entrypointInfo: { chainId: 1n, entrypointAddress: entrypoint, deploymentBlock: 100n },
});

const sync = (store: ReturnType<typeof setupStore>, dataService: Awaited<ReturnType<typeof chainDataService>>) =>
  store.dispatch(syncThunk({
    dataService: dataService as unknown as IDataService,
    aspService: {} as IAspService,
    skipAsp: true,
  })).unwrap();

describe('pool state-root verification', () => {
  it('fails the sync and keeps the sync point when the leaf stream is truncated', async () => {
    const store = setupStore();
    // Leaf 2 (block 108, before the head) is missing: the local tree is the
    // prefix [11], whose root is still in the Pool's recent history.
    const dataService = await chainDataService({ dropLeaves: [2n] });

    await expect(sync(store, dataService)).rejects.toThrow('State root verification failed');
    expect(store.getState().sync.lastSyncedBlock).toBe('0');
  });

  it('fails the sync and keeps the sync point when the leaf stream has a hole', async () => {
    const store = setupStore();
    const dataService = await chainDataService({ dropLeaves: [1n] });

    await expect(sync(store, dataService)).rejects.toThrow('leaf 1 is missing');
    expect(store.getState().sync.lastSyncedBlock).toBe('0');
  });

  it('fails the sync and keeps the sync point when every leaf is dropped', async () => {
    const store = setupStore();
    // No leaves stored at all: the pool must still be read, as an empty tree.
    const dataService = await chainDataService({ dropLeaves: [1n, 2n, 3n] });

    await expect(sync(store, dataService)).rejects.toThrow('State root verification failed');
    expect(dataService.getPoolStateRoot).toHaveBeenCalledWith(pool, HEAD);
    expect(store.getState().sync.lastSyncedBlock).toBe('0');
  });

  it('accepts a complete tree when the pool has moved past the sync head', async () => {
    const store = setupStore();
    const dataService = await chainDataService();

    await sync(store, dataService);

    expect(selectLastSyncedBlock(store.getState())).toBe(HEAD);
  });

  it('keeps the sync point without reading pool roots when the RPC is behind it', async () => {
    const store = setupStore();
    // The second sync's RPC reports a head below the first sync's.
    const dataService = await chainDataService({ heads: [HEAD, HEAD - 10n] });

    await sync(store, dataService);
    dataService.getPoolStateRoot.mockClear();

    await sync(store, dataService);

    expect(dataService.getPoolStateRoot).not.toHaveBeenCalled();
    expect(selectLastSyncedBlock(store.getState())).toBe(HEAD);
  });
});
