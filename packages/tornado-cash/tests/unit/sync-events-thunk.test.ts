import { describe, expect, it, vi } from 'vitest';
import { TornadoCashConfigs } from '../../src/config';
import type { IGetEventsParams, IGetPoolEventsResult, ISyncService } from '../../src/data/interfaces/sync.service.interface';
import type { IPool } from '../../src/data/interfaces/events.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { depositsSelector, poolsSelector } from '../../src/state/selectors/slices.selectors';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeFactory } from '../../src/state/store';
import { syncEventsThunk } from '../../src/state/thunks/syncEventsThunk';
import { TornadoPoolSyncError } from '../../src/state/pool-sync-error';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';

// The root check has its own tests (sync-events-root-check, sync-events-verification);
// here every pool passes it.
vi.mock('../../src/verification/root-verification', async (importOriginal) => {
  const { emptyFrontier } = await import('../../src/utils/merkle-frontier');

  return {
    ...await importOriginal<object>(),
    verifyPoolLeavesAt: vi.fn(async () => ({ root: 0n, frontier: emptyFrontier() })),
  };
});

const dataService = {
  getBlockNumber: async () => 1_000n,
  getFinalizedBlockNumber: async () => 1_000n,
} as unknown as IDataService;

const okPool = 0x1000n as Address;
const failingPool = 0x2000n as Address;
const failingPoolHex = `0x${'0'.repeat(36)}2000`;
const makeStore = () => storeFactory({ logLevel: 'off', protocolConfig: TornadoCashConfigs[1] });
const pool = (address: Address, registeredBlock: bigint): IPool => ({
  address,
  asset: 0n,
  isERC20: false,
  denomination: 10n ** 17n,
  protocolFeePercentage: 0,
  registeredBlock,
  state: 1,
  rootHistorySize: 100,
});
const events = (toBlock: bigint, commitment?: bigint): IGetPoolEventsResult => ({
  Deposited: commitment === undefined ? [] : [{ commitment, leafIndex: 0, timestamp: 0n, blockNumber: toBlock, transactionHash: 0n }],
  Withdrawn: [],
  fromBlock: 0n,
  toBlock,
} as IGetPoolEventsResult);
// The shape viem uses for an RPC rejection: a short first line, then request details
// including the URL, which for hosted RPCs carries the API key.
const rangeLimitError = new Error(
  'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range.\n\n' +
  'URL: https://eth-sepolia.g.alchemy.com/v2/SECRET_API_KEY\nRequest body: {"method":"eth_getLogs"}',
);
const syncService = (getPoolEvents: (params: IGetEventsParams) => Promise<IGetPoolEventsResult>) =>
  ({ getPoolEvents: vi.fn(getPoolEvents) }) as unknown as ISyncService & { getPoolEvents: ReturnType<typeof vi.fn> };

describe('syncEventsThunk', () => {
  it('reports the pools whose events could not be fetched, in an error that names them', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(okPool, 100n), pool(failingPool, 200n)]));

    const action = await store.dispatch(syncEventsThunk({
      dataService,
      syncService: syncService(async ({ address }) => {
        if (address === failingPool) throw rangeLimitError;

        return events(500n, 7n);
      }),
    }));

    expect(action.meta.requestStatus).toBe('fulfilled');

    const { failures, poolCount } = action.payload as { failures: { pool: Address; reason: string }[]; poolCount: number };

    expect(failures.map(({ pool }) => pool)).toEqual([failingPool]);
    expect(failures[0]!.reason).not.toContain('SECRET_API_KEY');

    const error = new TornadoPoolSyncError(failures, poolCount);

    expect(error.name).toBe('TornadoPoolSyncError');
    expect(error.message).toContain('1 of 2 Tornado pools');
    expect(error.message).toContain(failingPoolHex);
    expect(error.message).toContain('up to a 10 block range');
    expect(error.message).not.toContain('SECRET_API_KEY');
    expect(error.message).not.toContain('URL:');
  });

  it('keeps the progress of pools that synced and leaves failed pools at their previous cursor', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(okPool, 100n), pool(failingPool, 200n)]));
    await store.dispatch(syncEventsThunk({
      dataService,
      syncService: syncService(async ({ address }) => {
        if (address === failingPool) throw rangeLimitError;

        return events(500n, 7n);
      }),
    }));

    const pools = poolsSelector(store.getState());

    expect(pools.get(okPool)?.lastSyncedBlock).toBe(500n);
    expect(pools.get(failingPool)?.lastSyncedBlock).toBeUndefined();
    const deposits = depositsSelector(store.getState());

    expect([...(deposits.get(okPool)?.keys() ?? [])]).toEqual([7n]);
    expect(deposits.has(failingPool)).toBe(false);
  });

  it('retries a failed pool from where it stopped on the next sync', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(okPool, 100n), pool(failingPool, 200n)]));
    await store.dispatch(syncEventsThunk({
      dataService,
      syncService: syncService(async ({ address }) => {
        if (address === failingPool) throw rangeLimitError;

        return events(500n);
      }),
    }));

    const retry = syncService(async ({ address }) => events(address === failingPool ? 600n : 650n));
    const action = await store.dispatch(syncEventsThunk({ dataService, syncService: retry }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(action.payload).toMatchObject({ lastBlock: 650n, failures: [] });
    expect(retry.getPoolEvents).toHaveBeenCalledWith(expect.objectContaining({ address: failingPool, fromBlock: 200n }));
    expect(retry.getPoolEvents).toHaveBeenCalledWith(expect.objectContaining({ address: okPool, fromBlock: 500n }));
    expect(poolsSelector(store.getState()).get(failingPool)?.lastSyncedBlock).toBe(600n);
  });

  it('resolves with the highest synced block when every pool syncs', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(okPool, 100n), pool(failingPool, 200n)]));

    const action = await store.dispatch(syncEventsThunk({
      dataService,
      syncService: syncService(async ({ address }) => events(address === okPool ? 400n : 450n)),
    }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(action.payload).toEqual({ lastBlock: 450n, poolCount: 2, failures: [] });
  });
});
