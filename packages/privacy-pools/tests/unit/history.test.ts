import { describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { interpolateTimestamp, myHistorySelector } from '../../src/state/selectors/history.selector';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { registerRagequits } from '../../src/state/slices/ragequitsSlice';
import { setLastSyncedBlock } from '../../src/state/slices/syncSlice';
import { addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { registerWithdrawals } from '../../src/state/slices/withdrawalsSlice';
import { RootState, storeFactory } from '../../src/state/store';
import { syncHistoryTimestampsThunk } from '../../src/state/thunks/syncHistoryTimestampsThunk';
import { serialize } from '../../src/state/utils/serialize.utils';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const pool = 1000n as Address;
const asset = 2000n as Address;
const depositor = 3000n as Address;
const deploymentBlock = 100_000n;
const head = 200_000n;
// The timestamp grid (multiples of 2^15) from the deployment to the head, then the head.
const expectedAnchorBlocks = [98_304n, 131_072n, 163_840n, 196_608n, head];

const noteSecret = (noteIndex: number, precommitment: bigint, nullifierHash: bigint) => ({
  noteIndex,
  nullifier: 0n,
  salt: 0n,
  precommitment,
  nullifierHash,
});

// As stored by the bulk sync, with the hash and log index the RPC returned.
const depositA = {
  pool, depositor, commitment: 11n, label: 10n, precommitment: 1n, value: 100n,
  blockNumber: 150_005n, transactionHash: 0xa5n, logIndex: 2,
};
const depositB = {
  pool, depositor, commitment: 21n, label: 20n, precommitment: 2n, value: 50n,
  blockNumber: 180_008n, transactionHash: 0xb8n, logIndex: 1,
};
const withdrawalA = {
  pool, spentNullifier: 111n, commitment: 12n, value: 40n,
  blockNumber: 180_008n, transactionHash: 0xc8n, logIndex: 3,
};
// From a source without transaction hashes (saga, or a state synced before they were kept).
const ragequitB = {
  pool, ragequitter: depositor, commitment: 21n, label: 20n, value: 50n,
  blockNumber: 199_009n, transactionHash: 0n,
};

const setupStore = ({ withUserEvents = true, initialState }: { withUserEvents?: boolean; initialState?: Partial<RootState> } = {}) => {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock },
    initialState: initialState as RootState | undefined,
  });

  store.dispatch(registerPools([{ address: pool, asset, scope: 1n, registeredBlock: deploymentBlock, woundDownAtBlock: null }]));
  store.dispatch(registerAspTree({ leaves: [depositA.label], aspTreeRoot: 1n, blockNumber: 1n }));
  store.dispatch(registerDeposits([depositA, depositB]));
  store.dispatch(registerWithdrawals([withdrawalA]));
  store.dispatch(registerRagequits([ragequitB]));
  store.dispatch(setLastSyncedBlock(head));

  if (withUserEvents) {
    // Deposit A was withdrawn from once (spending the note with nullifierHash 111).
    store.dispatch(addUserSecret({
      depositIndex: 0,
      noteSecrets: [noteSecret(0, depositA.precommitment, withdrawalA.spentNullifier), noteSecret(1, 0n, 112n)],
    }));
    store.dispatch(addUserSecret({ depositIndex: 1, noteSecrets: [noteSecret(0, depositB.precommitment, 211n)] }));
  }

  return store;
};

// 12 s blocks with a missed slot every 100 blocks, so interpolation is not exact.
const timestampOf = (blockNumber: bigint) => 1_700_000_000n + blockNumber * 12n + (blockNumber / 100n) * 12n;

// Only header lookups exist: any per-event log lookup would throw.
const mockDataService = () => ({
  getBlockTimestamp: vi.fn(async (blockNumber: bigint) => timestampOf(blockNumber)),
});

const sync = (store: ReturnType<typeof setupStore>, dataService: ReturnType<typeof mockDataService>) =>
  store.dispatch(syncHistoryTimestampsThunk({ dataService: dataService as unknown as IDataService })).unwrap();

const requestedBlocks = (dataService: ReturnType<typeof mockDataService>) =>
  dataService.getBlockTimestamp.mock.calls.map(([blockNumber]) => blockNumber).sort((a, b) => Number(a - b));

describe('history', () => {
  it('builds history from the bulk sync and interpolated timestamps, newest first', async () => {
    const store = setupStore();

    expect(myHistorySelector(store.getState())).toEqual([]);

    await sync(store, mockDataService());

    const common = { poolAddress: pool, assetAddress: asset, timestamp: expect.any(BigInt) };
    const history = myHistorySelector(store.getState());

    expect(history).toEqual([
      { ...common, type: 'ragequit', ragequitter: depositor, value: 50n, blockNumber: 199_009n, logIndex: 0, transactionHash: 0n },
      { ...common, type: 'withdrawal', value: 40n, blockNumber: 180_008n, logIndex: 3, transactionHash: 0xc8n },
      {
        ...common, type: 'deposit', depositor, label: 20n, aspStatus: 'pending', value: 50n,
        blockNumber: 180_008n, logIndex: 1, transactionHash: 0xb8n,
      },
      {
        ...common, type: 'deposit', depositor, label: 10n, aspStatus: 'approved', value: 100n,
        blockNumber: 150_005n, logIndex: 2, transactionHash: 0xa5n,
      },
    ]);

    // Off by at most the missed slots inside one grid cell.
    for (const { blockNumber, timestamp } of history) {
      const error = timestamp - timestampOf(blockNumber);

      expect(error < 0n ? -error : error).toBeLessThanOrEqual(12n * 2n ** 15n / 100n);
    }
  });

  it('asks the RPC for the same blocks whatever the account holds', async () => {
    const withEvents = mockDataService();
    const withoutEvents = mockDataService();

    await sync(setupStore(), withEvents);
    await sync(setupStore({ withUserEvents: false }), withoutEvents);

    expect(requestedBlocks(withEvents)).toEqual(expectedAnchorBlocks);
    expect(requestedBlocks(withoutEvents)).toEqual(expectedAnchorBlocks);
  });

  it('keeps grid headers and only replaces the head on the next call', async () => {
    const store = setupStore();

    await sync(store, mockDataService());
    store.dispatch(setLastSyncedBlock(240_000n));

    const dataService = mockDataService();

    await sync(store, dataService);

    expect(requestedBlocks(dataService)).toEqual([229_376n, 240_000n]);
    expect(store.getState().historyMetadata.timestampAnchors?.map(([blockNumber]) => BigInt(blockNumber)))
      .not.toContain(head);
  });

  it('prefers exact metadata fetched by older versions', async () => {
    const legacy = { transactionHash: 0xd9n, logIndex: 4, timestamp: 42n };
    const store = setupStore({
      initialState: {
        historyMetadata: { metadataTuples: serialize([[ragequitB.label, legacy]]), timestampAnchors: [] },
      } as unknown as Partial<RootState>,
    });

    await sync(store, mockDataService());

    expect(myHistorySelector(store.getState())[0]).toMatchObject({ type: 'ragequit', ...legacy });
  });
});

describe('interpolateTimestamp', () => {
  const anchors: [bigint, bigint][] = [[0n, 1000n], [100n, 2300n], [200n, 3500n]];

  it('is exact at anchors and linear between them', () => {
    expect(interpolateTimestamp(anchors, 0n)).toBe(1000n);
    expect(interpolateTimestamp(anchors, 100n)).toBe(2300n);
    expect(interpolateTimestamp(anchors, 50n)).toBe(1650n);
    expect(interpolateTimestamp(anchors, 150n)).toBe(2900n);
    expect(interpolateTimestamp(anchors, 200n)).toBe(3500n);
  });

  it('returns undefined outside the anchors', () => {
    expect(interpolateTimestamp(anchors, 201n)).toBeUndefined();
    expect(interpolateTimestamp([], 1n)).toBeUndefined();
  });
});
