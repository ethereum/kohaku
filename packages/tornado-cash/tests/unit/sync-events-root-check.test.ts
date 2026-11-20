import { describe, expect, it, vi } from 'vitest';
import { buildTree } from '#merkle-tree';

import { IDataService } from '../../src/data/interfaces/data.service.interface';
import { IGetPoolEventsResult, ISyncService } from '../../src/data/interfaces/sync.service.interface';
import { IPool, IRawDepositEvent } from '../../src/data/interfaces/events.interface';
import { Address, Commitment } from '../../src/interfaces/types.interface';
import { depositsSelector, poolsSelector } from '../../src/state/selectors/slices.selectors';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeFactory } from '../../src/state/store';
import { syncEventsThunk, SyncEventsResult } from '../../src/state/thunks/syncEventsThunk';

// Real mainnet instances: synced pools are restricted to the instance catalog.
const POOL_A = 0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936n as Address; // 1 ETH
const POOL_B = 0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbFn as Address; // 10 ETH
const HEAD = 1_000n;

function makeStore() {
  return storeFactory({
    protocolConfig: {
      chainId: 1n,
      ensSubdomainKey: 'eth',
      instanceRegistry: { address: 1n, deploymentBlock: 0n },
      relayerRegistry: { address: 2n, deploymentBlock: 0n },
      aggregator: { address: 3n },
    },
    logLevel: 'off',
  });
}

function pool(address: Address, lastSyncedBlock?: bigint): IPool {
  return {
    address,
    asset: 0n,
    isERC20: false,
    protocolFeePercentage: 0,
    denomination: 10n ** 18n,
    registeredBlock: 10n,
    state: 1,
    rootHistorySize: 30,
    ...(lastSyncedBlock === undefined ? {} : { lastSyncedBlock }),
  };
}

const deposit = (commitment: bigint, leafIndex: number): IRawDepositEvent => ({
  commitment: commitment as Commitment,
  leafIndex,
  timestamp: 0n,
  blockNumber: BigInt(100 + leafIndex),
  transactionHash: 0n,
});

const rootOf = async (commitments: bigint[]) => BigInt((await buildTree(commitments)).root);

/** A chain whose pools hold `onchain` commitments at HEAD. */
async function chainWith(onchain: Map<Address, bigint[]>) {
  const roots = new Map<Address, bigint>();

  for (const [address, commitments] of onchain) roots.set(address, await rootOf(commitments));

  const getPoolNextIndex = vi.fn(async (address: Address) => onchain.get(address)?.length ?? 0);

  return {
    getBlockNumber: vi.fn(async () => HEAD),
    getFinalizedBlockNumber: vi.fn(async () => HEAD),
    getPoolStateRoot: vi.fn(async (address: Address, blockNumber?: bigint) => {
      expect(blockNumber).toBe(HEAD);

      return roots.get(address)!;
    }),
    getPoolNextIndex,
    getPoolLeafCount: getPoolNextIndex,
  };
}

/** A sync source that serves `served` per pool, synced up to `toBlock`. */
function sourceServing(served: Map<Address, IRawDepositEvent[]>, toBlock = HEAD) {
  return {
    getPoolEvents: vi.fn(async ({ address }: { address: Address }): Promise<IGetPoolEventsResult> => ({
      Deposited: served.get(address) ?? [],
      Withdrawn: [],
      toBlock,
    })),
    getPoolDeploymentBlock: vi.fn(async () => 10n),
  } as unknown as ISyncService;
}

async function sync(
  store: ReturnType<typeof makeStore>,
  syncService: ISyncService,
  dataService: Awaited<ReturnType<typeof chainWith>>,
) {
  return store.dispatch(syncEventsThunk({ syncService, dataService: dataService as unknown as IDataService }));
}

/** The pools the sync reported as failed; the thunk itself resolves either way. */
const failuresOf = (action: { meta: { requestStatus: string }; payload?: unknown }) => {
  expect(action.meta.requestStatus).toBe('fulfilled');

  return (action.payload as SyncEventsResult).failures;
};

const storedCommitments = (store: ReturnType<typeof makeStore>, address: Address) =>
  [...(depositsSelector(store.getState()).get(address)?.keys() ?? [])];

describe('syncEventsThunk pool root check', () => {
  it('stores a complete stream and moves the cursor once its root matches the synced block', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(POOL_A)]));

    const chain = await chainWith(new Map([[POOL_A, [11n, 22n, 33n]]]));
    const action = await sync(store, sourceServing(new Map([[POOL_A, [deposit(11n, 0), deposit(22n, 1), deposit(33n, 2)]]])), chain);

    expect(failuresOf(action)).toEqual([]);
    expect((action.payload as SyncEventsResult).lastBlock).toBe(HEAD);
    expect(chain.getPoolStateRoot).toHaveBeenCalledWith(POOL_A, HEAD);
    expect(storedCommitments(store, POOL_A)).toEqual([11n, 22n, 33n]);
    expect(poolsSelector(store.getState()).get(POOL_A)?.lastSyncedBlock).toBe(HEAD);
  });

  it('completes the stored tree with the new events before checking it', async () => {
    const store = makeStore();

    store.dispatch(registerPools([{ ...pool(POOL_A, 500n), finalizedBlock: 500n }]));
    store.dispatch(registerDeposits([{ ...deposit(11n, 0), pool: POOL_A }]));

    const chain = await chainWith(new Map([[POOL_A, [11n, 22n]]]));
    const action = await sync(store, sourceServing(new Map([[POOL_A, [deposit(22n, 1)]]])), chain);

    expect(failuresOf(action)).toEqual([]);
    expect(storedCommitments(store, POOL_A)).toEqual([11n, 22n]);
  });

  it('fails a stream missing its newest leaves, although their root is still in the recent history', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(POOL_A, 50n)]));

    const chain = await chainWith(new Map([[POOL_A, [11n, 22n, 33n]]]));
    const action = await sync(store, sourceServing(new Map([[POOL_A, [deposit(11n, 0), deposit(22n, 1)]]])), chain);

    expect(failuresOf(action)).toEqual([{ pool: POOL_A, reason: expect.stringMatching(/holds 3 leaves/) }]);
    expect(storedCommitments(store, POOL_A)).toEqual([]);
    expect(poolsSelector(store.getState()).get(POOL_A)?.lastSyncedBlock).toBe(50n);
  });

  it('fails a stream with a hole in its leaf indices before any on-chain read', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(POOL_A, 50n)]));

    const chain = await chainWith(new Map([[POOL_A, [11n, 22n, 33n]]]));
    const action = await sync(store, sourceServing(new Map([[POOL_A, [deposit(11n, 0), deposit(33n, 2)]]])), chain);

    expect(failuresOf(action)).toEqual([{ pool: POOL_A, reason: expect.stringMatching(/not contiguous/) }]);
    expect(chain.getPoolStateRoot).not.toHaveBeenCalled();
    expect(poolsSelector(store.getState()).get(POOL_A)?.lastSyncedBlock).toBe(50n);
  });

  it('fails a forged event that reuses a stored leaf index', async () => {
    const store = makeStore();

    store.dispatch(registerPools([{ ...pool(POOL_A, 500n), finalizedBlock: 500n }]));
    store.dispatch(registerDeposits([{ ...deposit(11n, 0), pool: POOL_A }]));

    const chain = await chainWith(new Map([[POOL_A, [11n]]]));
    const action = await sync(store, sourceServing(new Map([[POOL_A, [deposit(99n, 0)]]])), chain);

    expect(failuresOf(action).map(({ pool }) => pool)).toEqual([POOL_A]);
    expect(storedCommitments(store, POOL_A)).toEqual([11n]);
  });

  it('fails an empty stream for a pool that holds deposits on-chain', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(POOL_A, 50n)]));

    const chain = await chainWith(new Map([[POOL_A, [11n]]]));
    const action = await sync(store, sourceServing(new Map()), chain);

    expect(failuresOf(action).map(({ pool }) => pool)).toEqual([POOL_A]);
    expect(chain.getPoolNextIndex).toHaveBeenCalledWith(POOL_A, HEAD);
    expect(poolsSelector(store.getState()).get(POOL_A)?.lastSyncedBlock).toBe(50n);
  });

  it('keeps the progress of a pool that passes when another pool fails', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(POOL_A, 50n), pool(POOL_B, 50n)]));

    const chain = await chainWith(new Map([[POOL_A, [11n]], [POOL_B, [44n, 55n]]]));
    const action = await sync(store, sourceServing(new Map([
      [POOL_A, [deposit(11n, 0)]],
      [POOL_B, [deposit(44n, 0)]],
    ])), chain);

    expect(failuresOf(action).map(({ pool }) => pool)).toEqual([POOL_B]);
    expect(storedCommitments(store, POOL_A)).toEqual([11n]);
    expect(poolsSelector(store.getState()).get(POOL_A)?.lastSyncedBlock).toBe(HEAD);
    expect(storedCommitments(store, POOL_B)).toEqual([]);
    expect(poolsSelector(store.getState()).get(POOL_B)?.lastSyncedBlock).toBe(50n);
  });

  it('reads the pools on-chain concurrently rather than one after another', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(POOL_A, 50n), pool(POOL_B, 50n)]));

    const chain = await chainWith(new Map([[POOL_A, [11n]], [POOL_B, [44n]]]));
    const readRoot = chain.getPoolStateRoot.getMockImplementation()!;
    let poolBRead!: () => void;
    const poolBReading = new Promise<void>((resolve) => { poolBRead = resolve; });

    // Pool A's read only completes once pool B's has been sent: serial reads would hang.
    chain.getPoolStateRoot.mockImplementation(async (address, blockNumber) => {
      if (address === POOL_A) await poolBReading;
      else poolBRead();

      return readRoot(address, blockNumber);
    });

    const action = await sync(store, sourceServing(new Map([
      [POOL_A, [deposit(11n, 0)]],
      [POOL_B, [deposit(44n, 0)]],
    ])), chain);

    expect(failuresOf(action)).toEqual([]);
    expect(storedCommitments(store, POOL_A)).toEqual([11n]);
    expect(storedCommitments(store, POOL_B)).toEqual([44n]);
  });

  it('skips the check when the RPC is behind the cursor and scanned nothing', async () => {
    const store = makeStore();

    store.dispatch(registerPools([{ ...pool(POOL_A, 2_000n), finalizedBlock: 2_000n }]));

    const chain = await chainWith(new Map([[POOL_A, [11n]]]));

    chain.getBlockNumber.mockResolvedValue(2_000n);
    const action = await sync(store, sourceServing(new Map()), chain);

    expect(failuresOf(action)).toEqual([]);
    expect(chain.getPoolStateRoot).not.toHaveBeenCalled();
    expect(chain.getPoolNextIndex).not.toHaveBeenCalled();
  });
});
