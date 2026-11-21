import { unwrapResult } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IDataService } from '../../src/data/interfaces/data.service.interface';
import { IPool, IRawDepositEvent, IRawWithdrawalEvent } from '../../src/data/interfaces/events.interface';
import { IGetPoolEventsParams, ISyncService } from '../../src/data/interfaces/sync.service.interface';
import { Address, Commitment, NullifierHash } from '../../src/interfaces/types.interface';
import { depositsSelector, poolsSelector, withdrawalsSelector } from '../../src/state/selectors/slices.selectors';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { registerWithdrawals } from '../../src/state/slices/withdrawalsSlice';
import { storeFactory } from '../../src/state/store';
import { LEGACY_REWIND_BLOCKS, syncEventsThunk, SyncEventsResult } from '../../src/state/thunks/syncEventsThunk';
import { appendLeaves, emptyFrontier, frontierOf } from '../../src/utils/merkle-frontier';
import { buildTree } from '../../src/utils/merkle-tree/merkle-tree.util.node';

const POOL = 0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936n as Address;
const HEAD = 1_000n;
const FINALIZED = 900n;
const DEPLOYED = 10n;

const deposit = (leafIndex: number, blockNumber: bigint, commitment = BigInt(leafIndex + 1)): IRawDepositEvent => ({
  commitment: commitment as Commitment,
  leafIndex,
  timestamp: 0n,
  blockNumber,
  transactionHash: 0n,
});

const withdrawal = (nullifierHash: bigint, blockNumber: bigint): IRawWithdrawalEvent => ({
  nullifierHash: nullifierHash as NullifierHash,
  to: 1n as Address,
  relayer: 0n as Address,
  fee: 0n,
  blockNumber,
  transactionHash: 0n,
});

const rootOf = async (deposits: IRawDepositEvent[]) =>
  BigInt((await buildTree(deposits.map(({ commitment }) => commitment))).root);

function pool(fields: Partial<IPool> = {}): IPool {
  return {
    address: POOL,
    asset: 0n,
    isERC20: false,
    protocolFeePercentage: 0,
    denomination: 10n ** 18n,
    registeredBlock: DEPLOYED,
    state: 1,
    rootHistorySize: 100,
    ...fields,
  };
}

function storeWith(fields: Partial<IPool> = {}) {
  const store = storeFactory({
    protocolConfig: {
      chainId: 1n,
      ensSubdomainKey: 'eth',
      instanceRegistry: { address: 1n, deploymentBlock: 0n },
      relayerRegistry: { address: 2n, deploymentBlock: 0n },
      aggregator: { address: 3n },
      useExtendedEthPools: false,
    },
    logLevel: 'off',
  });

  store.dispatch(registerPools([pool(fields)]));

  return store;
}

/** The chain holds `onchain`; each scan is answered by `serve`. */
function services(onchain: IRawDepositEvent[], serve: (params: IGetPoolEventsParams) => {
  Deposited: IRawDepositEvent[];
  Withdrawn?: IRawWithdrawalEvent[];
  external?: boolean;
}) {
  const scans: IGetPoolEventsParams[] = [];
  const dataService = {
    getBlockNumber: vi.fn(async () => HEAD),
    getFinalizedBlockNumber: vi.fn(async () => FINALIZED),
    getPoolLeafCount: vi.fn(async () => onchain.length),
    getPoolStateRoot: vi.fn(async () => rootOf(onchain)),
  };
  const syncService = {
    getPoolEvents: vi.fn(async (params: IGetPoolEventsParams) => {
      scans.push(params);
      const { Deposited, Withdrawn = [], external = false } = serve(params);

      return { Deposited, Withdrawn, toBlock: HEAD, external };
    }),
    getPoolDeploymentBlock: vi.fn(async () => DEPLOYED),
  };

  return {
    scans,
    dataService,
    syncService,
    params: {
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    },
  };
}

const chainFrom = (chain: IRawDepositEvent[]) => ({ fromBlock }: IGetPoolEventsParams) => ({
  Deposited: chain.filter(({ blockNumber }) => blockNumber >= fromBlock),
});

/** The pools the sync reported as failed; the thunk itself resolves either way. */
const failuresOf = (action: { meta: { requestStatus: string }; payload?: unknown }) => {
  expect(action.meta.requestStatus).toBe('fulfilled');

  return (action.payload as SyncEventsResult).failures;
};

const storedCommitments = (store: ReturnType<typeof storeWith>) =>
  [...(depositsSelector(store.getState()).get(POOL)?.keys() ?? [])].sort((a, b) => Number(a - b));

describe('syncEventsThunk pool verification', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores a verified scan and moves both cursors', async () => {
    const chain = [deposit(0, 100n), deposit(1, 950n)];
    const store = storeWith();
    const { params, scans } = services(chain, chainFrom(chain));

    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans).toEqual([expect.objectContaining({ fromBlock: DEPLOYED, chainOnly: false })]);
    expect(storedCommitments(store)).toEqual([1n, 2n]);
    expect(poolsSelector(store.getState()).get(POOL)).toMatchObject({
      lastSyncedBlock: HEAD,
      finalizedBlock: FINALIZED,
      verifiedRoot: await rootOf(chain),
    });
  });

  it('retries a forged provider scan from the chain and stores only the chain events', async () => {
    const chain = [deposit(0, 100n), deposit(1, 950n)];
    // A deposit from another pool, served as if it were this pool's second leaf.
    const forged = [deposit(0, 100n), deposit(1, 950n, 77n)];
    const store = storeWith();
    const { params, scans } = services(chain, ({ chainOnly }) =>
      chainOnly ? { Deposited: chain } : { Deposited: forged, external: true });

    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans.map(({ chainOnly }) => chainOnly)).toEqual([false, true]);
    expect(storedCommitments(store)).toEqual([1n, 2n]);
  });

  it('fails a truncated stream without storing it or moving the cursor', async () => {
    const chain = [deposit(0, 100n), deposit(1, 950n)];
    const store = storeWith({ lastSyncedBlock: 500n, finalizedBlock: 500n });

    store.dispatch(registerDeposits([{ ...chain[0]!, pool: POOL }]));

    // The source drops the newest deposit on every scan, chain-only or not.
    const { params, scans } = services(chain, () => ({ Deposited: [chain[0]!] }));

    // The chain scan from the cursor, then a replay from deployment; no retry
    // without the provider, which served neither.
    const action = await store.dispatch(syncEventsThunk(params));

    expect(failuresOf(action)).toEqual([{ pool: POOL, reason: expect.stringMatching(/holds 2 leaves/) }]);
    expect(scans.map(({ fromBlock, chainOnly }) => [fromBlock, chainOnly])).toEqual([[500n, false], [DEPLOYED, true]]);
    expect(storedCommitments(store)).toEqual([1n]);
    expect(poolsSelector(store.getState()).get(POOL)).toMatchObject({ lastSyncedBlock: 500n, finalizedBlock: 500n });
  });

  it('replays the pool from deployment when its stored deposits are bad', async () => {
    const chain = [deposit(0, 100n), deposit(1, 950n)];
    // Saved by an earlier version from a source that forged a leaf below the cursor.
    const store = storeWith({ lastSyncedBlock: 500n, finalizedBlock: 500n });

    store.dispatch(registerDeposits([{ ...deposit(0, 100n, 77n), pool: POOL }]));

    const { params, scans } = services(chain, chainFrom(chain));

    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans.map(({ fromBlock }) => fromBlock)).toEqual([500n, DEPLOYED]);
    expect(storedCommitments(store)).toEqual([1n, 2n]);
    expect(poolsSelector(store.getState()).get(POOL)?.finalizedBlock).toBe(FINALIZED);
  });

  it('drops reorged deposits and withdrawals after the finalized cursor', async () => {
    const chain = [deposit(0, 100n)];
    const store = storeWith({ lastSyncedBlock: 960n, finalizedBlock: 800n });

    // Stored by the last sync from a branch that was later reorged away.
    store.dispatch(registerDeposits([{ ...deposit(0, 100n), pool: POOL }, { ...deposit(1, 850n), pool: POOL }]));
    store.dispatch(registerWithdrawals([
      { ...withdrawal(5n, 700n), pool: POOL },
      { ...withdrawal(6n, 850n), pool: POOL },
    ]));

    const { params, scans } = services(chain, chainFrom(chain));

    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans.map(({ fromBlock }) => fromBlock)).toEqual([800n]);
    expect(storedCommitments(store)).toEqual([1n]);
    expect([...withdrawalsSelector(store.getState()).keys()]).toEqual([5n]);
  });

  it('rewinds a pool saved before the finalized cursor existed', async () => {
    const lastSyncedBlock = FINALIZED + 50n + LEGACY_REWIND_BLOCKS;
    const store = storeWith({ registeredBlock: DEPLOYED, lastSyncedBlock });
    const { params, scans } = services([], () => ({ Deposited: [] }));

    // Within the head, so not an impossible cursor; rewound and clamped to finality.
    params.dataService.getBlockNumber = async () => lastSyncedBlock;
    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans.map(({ fromBlock }) => fromBlock)).toEqual([FINALIZED]);
  });

  it('fails the pool on a transport error without retrying or replaying', async () => {
    const chain = [deposit(0, 100n)];
    const store = storeWith({ lastSyncedBlock: 500n, finalizedBlock: 500n });
    const { params, scans, dataService } = services(chain, chainFrom(chain));

    dataService.getPoolStateRoot.mockRejectedValue(new Error('rpc down'));

    const action = await store.dispatch(syncEventsThunk(params));

    // The pool is not dropped silently: it is reported, so the sync fails (F-27).
    expect(failuresOf(action)).toEqual([{ pool: POOL, reason: 'rpc down' }]);

    expect(scans).toHaveLength(1);
    expect(poolsSelector(store.getState()).get(POOL)).toMatchObject({ lastSyncedBlock: 500n, finalizedBlock: 500n });
  });

  it('keeps saved events when a lagging scan stops before the saved head', async () => {
    const saved = deposit(0, 950n);
    const store = storeWith({ lastSyncedBlock: HEAD, finalizedBlock: FINALIZED });

    store.dispatch(registerDeposits([{ ...saved, pool: POOL }]));

    const { params, syncService, dataService } = services([saved], () => ({ Deposited: [] }));

    syncService.getPoolEvents.mockResolvedValue({ Deposited: [], Withdrawn: [], toBlock: 940n, external: false });
    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(storedCommitments(store)).toEqual([saved.commitment]);
    expect(poolsSelector(store.getState()).get(POOL)).toMatchObject({ lastSyncedBlock: HEAD, finalizedBlock: FINALIZED });
    expect(dataService.getPoolLeafCount).not.toHaveBeenCalled();
  });

  it('does not erase a legacy deposit during replay against a lagging RPC', async () => {
    const saved = deposit(0, HEAD);
    const store = storeWith({ lastSyncedBlock: HEAD });

    store.dispatch(registerDeposits([{ ...saved, pool: POOL }]));

    const { params, syncService, dataService } = services([saved], () => ({ Deposited: [] }));

    dataService.getBlockNumber.mockResolvedValue(HEAD - 1n);
    syncService.getPoolEvents.mockResolvedValue({ Deposited: [], Withdrawn: [], toBlock: HEAD - 1n, external: false });
    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(storedCommitments(store)).toEqual([saved.commitment]);
    expect(poolsSelector(store.getState()).get(POOL)?.lastSyncedBlock).toBe(HEAD);
    expect(dataService.getPoolLeafCount).not.toHaveBeenCalled();
  });

  it('extends the saved frontier and saves it at the finalized block', async () => {
    const chain = [deposit(0, 100n), deposit(1, 850n), deposit(2, 950n)];
    const kept = chain.slice(0, 1);
    const store = storeWith({
      lastSyncedBlock: 820n,
      finalizedBlock: 800n,
      frontier: appendLeaves(emptyFrontier(), kept.map(({ commitment }) => commitment)),
    });

    store.dispatch(registerDeposits(kept.map((d) => ({ ...d, pool: POOL }))));

    const { params, scans } = services(chain, chainFrom(chain));

    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans).toHaveLength(1);
    // Saved below the new finalized block (900): leaves 0 and 1, not 2.
    expect(poolsSelector(store.getState()).get(POOL)?.frontier)
      .toEqual(frontierOf(await buildTree(chain.slice(0, 2).map(({ commitment }) => commitment))));
  });

  it('replays the pool when its saved frontier is wrong', async () => {
    const chain = [deposit(0, 100n), deposit(1, 950n)];
    const store = storeWith({
      lastSyncedBlock: 820n,
      finalizedBlock: 800n,
      // The right size for the kept deposit, built from another leaf.
      frontier: appendLeaves(emptyFrontier(), [77n]),
    });

    store.dispatch(registerDeposits([{ ...chain[0]!, pool: POOL }]));

    const { params, scans } = services(chain, chainFrom(chain));

    unwrapResult(await store.dispatch(syncEventsThunk(params)));

    expect(scans.map(({ fromBlock }) => fromBlock)).toEqual([800n, DEPLOYED]);
    expect(poolsSelector(store.getState()).get(POOL)?.verifiedRoot).toBe(await rootOf(chain));
  });
});
