import { describe, expect, it, vi } from 'vitest';
import type { IDataService, IPoolEventsWithLogMeta } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { myHistorySelector } from '../../src/state/selectors/history.selector';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { registerRagequits } from '../../src/state/slices/ragequitsSlice';
import { addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { registerWithdrawals } from '../../src/state/slices/withdrawalsSlice';
import { storeFactory } from '../../src/state/store';
import { syncHistoryMetadataThunk } from '../../src/state/thunks/syncHistoryMetadataThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const pool = 1000n as Address;
const asset = 2000n as Address;
const depositor = 3000n as Address;

const noteSecret = (noteIndex: number, precommitment: bigint, nullifierHash: bigint) => ({
  noteIndex,
  nullifier: 0n,
  salt: 0n,
  precommitment,
  nullifierHash,
});

const depositA = {
  pool, depositor, commitment: 11n, label: 10n, precommitment: 1n, value: 100n, blockNumber: 5n, transactionHash: 0n,
};
const depositB = {
  pool, depositor, commitment: 21n, label: 20n, precommitment: 2n, value: 50n, blockNumber: 8n, transactionHash: 0n,
};
const withdrawalA = {
  pool, spentNullifier: 111n, commitment: 12n, value: 40n, blockNumber: 8n, transactionHash: 0n,
};
const ragequitB = {
  pool, ragequitter: depositor, commitment: 21n, label: 20n, value: 50n, blockNumber: 9n, transactionHash: 0n,
};

// On-chain view of the pool, per block, with real hashes and log indexes.
const chainLogs: Record<string, IPoolEventsWithLogMeta> = {
  '5': { PoolDeposited: [{ ...depositA, transactionHash: 0xa5n, logIndex: 2 }], Withdrawn: [], Ragequit: [] },
  '8': {
    PoolDeposited: [{ ...depositB, transactionHash: 0xb8n, logIndex: 1 }],
    Withdrawn: [{ ...withdrawalA, transactionHash: 0xc8n, logIndex: 3 }],
    Ragequit: [],
  },
  '9': { PoolDeposited: [], Withdrawn: [], Ragequit: [{ ...ragequitB, transactionHash: 0xd9n, logIndex: 0 }] },
};

const setupStore = () => {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 0n },
  });

  store.dispatch(registerPools([{ address: pool, asset, scope: 1n, registeredBlock: 0n, woundDownAtBlock: null }]));
  store.dispatch(registerAspTree({ leaves: [depositA.label], aspTreeRoot: 1n, blockNumber: 1n }));
  store.dispatch(registerDeposits([depositA, depositB]));
  store.dispatch(registerWithdrawals([withdrawalA]));
  store.dispatch(registerRagequits([ragequitB]));
  // Deposit A was withdrawn from once (spending the note with nullifierHash 111).
  store.dispatch(addUserSecret({
    depositIndex: 0,
    noteSecrets: [noteSecret(0, depositA.precommitment, withdrawalA.spentNullifier), noteSecret(1, 0n, 112n)],
  }));
  store.dispatch(addUserSecret({ depositIndex: 1, noteSecrets: [noteSecret(0, depositB.precommitment, 211n)] }));

  return store;
};

const mockDataService = (logs = chainLogs) => ({
  getPoolEventsAtBlock: vi.fn(async (_pool: Address, blockNumber: bigint) => logs[blockNumber.toString()]),
  getBlockTimestamp: vi.fn(async (blockNumber: bigint) => blockNumber * 100n),
});

describe('history', () => {
  it('fetches metadata once per block and returns events newest first', async () => {
    const store = setupStore();
    const dataService = mockDataService();

    expect(myHistorySelector(store.getState())).toEqual([]);

    await store.dispatch(syncHistoryMetadataThunk({ dataService: dataService as unknown as IDataService })).unwrap();

    expect(dataService.getPoolEventsAtBlock).toHaveBeenCalledTimes(3);
    expect(dataService.getBlockTimestamp).toHaveBeenCalledTimes(3);

    const common = { poolAddress: pool, assetAddress: asset };

    expect(myHistorySelector(store.getState())).toEqual([
      {
        ...common, type: 'ragequit', ragequitter: depositor, value: 50n,
        blockNumber: 9n, logIndex: 0, transactionHash: 0xd9n, timestamp: 900n,
      },
      {
        ...common, type: 'withdrawal', value: 40n,
        blockNumber: 8n, logIndex: 3, transactionHash: 0xc8n, timestamp: 800n,
      },
      {
        ...common, type: 'deposit', depositor, label: 20n, aspStatus: 'pending', value: 50n,
        blockNumber: 8n, logIndex: 1, transactionHash: 0xb8n, timestamp: 800n,
      },
      {
        ...common, type: 'deposit', depositor, label: 10n, aspStatus: 'approved', value: 100n,
        blockNumber: 5n, logIndex: 2, transactionHash: 0xa5n, timestamp: 500n,
      },
    ]);
  });

  it('does not refetch cached metadata', async () => {
    const store = setupStore();
    const dataService = mockDataService();

    await store.dispatch(syncHistoryMetadataThunk({ dataService: dataService as unknown as IDataService })).unwrap();
    await store.dispatch(syncHistoryMetadataThunk({ dataService: dataService as unknown as IDataService })).unwrap();

    expect(dataService.getPoolEventsAtBlock).toHaveBeenCalledTimes(3);
  });

  it('throws when an event is missing on-chain', async () => {
    const store = setupStore();
    const dataService = mockDataService({
      ...chainLogs,
      '9': { PoolDeposited: [], Withdrawn: [], Ragequit: [] },
    });

    await expect(
      store.dispatch(syncHistoryMetadataThunk({ dataService: dataService as unknown as IDataService })).unwrap(),
    ).rejects.toThrow("Couldn't find ragequit log");
  });
});
