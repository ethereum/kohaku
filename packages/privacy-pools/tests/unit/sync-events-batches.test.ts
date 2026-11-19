import { poseidon } from 'maci-crypto/build/ts/hashing.js';
import { describe, expect, it, vi } from 'vitest';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { depositsSelector, poolsLeavesSelector, ragequitsSelector, withdrawalsSelector } from '../../src/state/selectors/slices.selectors';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { setSyncedBlocks } from '../../src/state/slices/syncSlice';
import { storeFactory } from '../../src/state/store';
import { syncEventsThunk } from '../../src/state/thunks/syncEventsThunk';
import { syncThunk } from '../../src/state/thunks/syncThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const pools = Array.from({ length: 9 }, (_, index) => ({
  address: BigInt(1000 + index) as Address, asset: 2000n as Address,
  scope: BigInt(index), registeredBlock: 1n, woundDownAtBlock: null,
}));
const setupStore = () => {
  const store = storeFactory({
    logLevel: 'off', devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 1n },
  });

  store.dispatch(registerPools(pools));
  store.dispatch(setSyncedBlocks({ head: 4n, finalized: 2n }));

  return store;
};
const poolEvents = (address: Address) => {
  const common = { blockNumber: 8n, transactionHash: 0n, commitment: poseidon([100n, address, address]), value: 100n };

  return {
    PoolDeposited: [{ ...common, depositor: 1n, label: address, precommitment: address }],
    Withdrawn: [{ ...common, spentNullifier: address }],
    Ragequit: [{ ...common, ragequitter: 1n, label: address }],
    LeafInserted: [{ ...common, index: 1n, root: 1n }],
    fromBlock: 2n, toBlock: 10n,
  };
};

describe('pool sync batches', () => {
  it('bounds concurrent scans and registers completed batches before fetching more', async () => {
    const store = setupStore();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = 0;
    let peak = 0;
    const getPoolEvents = vi.fn(async ({ address }: { address: Address }) => {
      active++;
      peak = Math.max(peak, active);

      if (address >= pools[4]!.address) expect(depositsSelector(store.getState()).size).toBeGreaterThanOrEqual(4);

      await gate;
      active--;

      return poolEvents(address);
    });
    const syncing = store.dispatch(syncEventsThunk({
      dataService: { getPoolEvents } as unknown as IDataService, fromBlock: 2n, toBlock: 10n,
    })).unwrap();

    expect(getPoolEvents).toHaveBeenCalledTimes(4);
    release();
    await syncing;

    expect(peak).toBe(4);
    expect(getPoolEvents).toHaveBeenCalledTimes(9);

    for (const select of [depositsSelector, withdrawalsSelector, ragequitsSelector]) {
      expect([...select(store.getState()).values()].map(event => event.pool)).toEqual(pools.map(pool => pool.address));
    }

    expect(poolsLeavesSelector(store.getState()).size).toBe(9);
  });

  it('keeps the cursor on a later batch failure, ignores late results and replays on retry', async () => {
    const store = setupStore();
    const cursor = store.getState().sync;
    let release!: () => void;
    const late = new Promise<void>(resolve => { release = resolve; });
    let fail = true;
    const dataService = {
      getBlockNumber: async () => 10n,
      getFinalizedBlockNumber: async () => 5n,
      getEntrypointEvents: async () => ({ EntrypointDeposited: [], RootUpdated: [], PoolRegistered: [], PoolWindDown: [] }),
      getAsset: async (address: Address) => ({ address, name: 'T', symbol: 'T', decimals: 18 }),
      getPoolEvents: vi.fn(async ({ address }: { address: Address }) => {
        if (fail && address === pools[4]!.address) throw new Error('rpc down');

        if (fail && address === pools[5]!.address) await late;

        return poolEvents(address);
      }),
    };
    const sync = () => store.dispatch(syncThunk({
      dataService: dataService as unknown as IDataService, aspService: {} as IAspService, verify: false, skipAsp: true,
    })).unwrap();

    await expect(sync()).rejects.toThrow('rpc down');
    expect(store.getState().sync).toEqual(cursor);
    expect(depositsSelector(store.getState()).size).toBe(4);
    expect(dataService.getPoolEvents).toHaveBeenCalledTimes(8);
    const failedState = store.getState();

    release();
    await late;
    await Promise.resolve();
    expect(store.getState()).toBe(failedState);

    fail = false;
    await sync();
    expect(depositsSelector(store.getState()).size).toBe(9);
    expect(poolsLeavesSelector(store.getState()).size).toBe(9);
    expect(BigInt(store.getState().sync.lastSyncedBlock)).toBe(10n);
    expect(BigInt(store.getState().sync.finalizedBlock!)).toBe(5n);
  });
});
