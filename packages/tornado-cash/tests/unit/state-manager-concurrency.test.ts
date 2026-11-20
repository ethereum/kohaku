import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager } from '../../src/account/keys';
import { TornadoCashConfigs } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import type { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { addLegacyUserSecret } from '../../src/state/slices/legacySecretsSlice';
import { setLastSyncedBlock } from '../../src/state/slices/syncSlice';
import { storeStateManager } from '../../src/state/state-manager';
import type { ITornadoProver } from '../../src/utils/tornado-prover';

type Dispatch = (action: unknown) => unknown;

// Each test decides what a sync and an import do to the store, and how long they take.
const hooks = vi.hoisted(() => ({
  sync: (async () => undefined) as (dispatch: Dispatch) => Promise<void>,
  importNotes: (async () => []) as (dispatch: Dispatch) => Promise<unknown[]>,
}));

vi.mock('../../src/state/thunks/syncThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  // Resolves with no failed pools, as a complete sync does.
  return { syncThunk: createAsyncThunk('test/sync', async (_: unknown, { dispatch }) => {
    await hooks.sync(dispatch);

    return { failures: [], totalPools: 0 };
  }) };
});
vi.mock('../../src/state/thunks/importLegacyNotesThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  return { importLegacyNotesThunk: createAsyncThunk('test/import', (_: unknown, { dispatch }) => hooks.importNotes(dispatch)) };
});
vi.mock('../../src/state/thunks/withdrawThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  return { withdrawThunk: createAsyncThunk('test/relayer', async () => []) };
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const POOL = 0x1234n;
const RECORD = { commitment: 1n, nullifierHash: 2n, nullifier: 3n, salt: 4n };

const importOneNote = async (dispatch: Dispatch) => {
  dispatch(addLegacyUserSecret({ poolAddress: POOL, record: RECORD }));

  return [];
};

/** In-memory storage whose reads and writes take as long as the test says. */
function createStorage({ getDelayMs = 0, setDelaysMs = [] as number[] } = {}) {
  const saved = new Map<string, string>();
  const setDelays = [...setDelaysMs];
  const get = vi.fn(async (key: string) => {
    await delay(getDelayMs);

    return saved.get(key);
  });
  const set = vi.fn(async (key: string, value: string) => {
    await delay(setDelays.shift() ?? 0);
    saved.set(key, value);
  });

  return {
    storage: { _brand: 'Storage', get, set } as unknown as Storage,
    get,
    saved: () => JSON.parse([...saved.values()][0]!),
  };
}

const setup = (storage: Storage) => storeStateManager({
  dataService: { getChainId: async () => 1n } as unknown as IDataService,
  syncService: {
    getRelayerRegistryEvents: async () => ({ RelayerRegistered: [], fromBlock: 0n, toBlock: 500n }),
  } as unknown as ISyncService,
  secretManagerFactory: async () => ({}) as ISecretManager,
  proverFactory: async () => ({}) as ITornadoProver,
  relayerClient: {} as IRelayerClient,
  paymasterConfig: {},
  storageToSyncTo: storage,
  protocolConfig: TornadoCashConfigs[1],
});

describe('state manager concurrency (F-54)', () => {
  beforeEach(() => {
    hooks.sync = async () => undefined;
    hooks.importNotes = async () => [];
  });

  it('builds one store for calls that race its first load', async () => {
    const { storage, get, saved } = createStorage({ getDelayMs: 10 });

    hooks.sync = async (dispatch) => { dispatch(setLastSyncedBlock(100n)); };
    hooks.importNotes = importOneNote;

    const manager = await setup(storage);

    await Promise.all([manager.importNotes({ notes: [] }), manager.sync()]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(saved().sync.lastSyncedBlock).toBe('0x64');
    expect(saved().legacySecrets.byPool).toHaveLength(1);
  });

  it('does not let a slower overlapping sync set progress back', async () => {
    const { storage, saved } = createStorage();
    // The first sync sees an older head and takes longer than the second.
    const heads = [150n, 200n];

    hooks.sync = async (dispatch) => {
      const head = heads.shift()!;

      await delay(head === 150n ? 20 : 0);
      dispatch(setLastSyncedBlock(head));
    };

    const manager = await setup(storage);

    await manager.getNotes({});
    await Promise.all([manager.sync(), manager.sync()]);

    expect(Object.values(manager.dumpState())[0]?.sync.lastSyncedBlock).toBe('0xc8');
    expect(saved().sync.lastSyncedBlock).toBe('0xc8');
  });

  it('does not let an import save overwrite a later sync save', async () => {
    // The first save is slow, so an unordered second save would land before it.
    const { storage, saved } = createStorage({ setDelaysMs: [30] });

    hooks.sync = async (dispatch) => {
      await delay(10);
      dispatch(setLastSyncedBlock(100n));
    };
    hooks.importNotes = importOneNote;

    const manager = await setup(storage);

    await manager.getNotes({});
    await Promise.all([manager.sync(), manager.importNotes({ notes: [] })]);

    expect(saved().sync.lastSyncedBlock).toBe('0x64');
    expect(saved().legacySecrets.byPool).toHaveLength(1);
  });

  it('does not let a relayer withdrawal save overwrite a later sync save', async () => {
    const { storage, saved } = createStorage({ setDelaysMs: [30] });

    hooks.sync = async (dispatch) => {
      await delay(10);
      dispatch(setLastSyncedBlock(100n));
    };

    const manager = await setup(storage);

    await manager.getNotes({});
    await Promise.all([
      manager.sync(),
      manager.getWithdrawalPayloads({ mode: 'relayer', asset: 0n, recipient: 1n }),
    ]);

    expect(saved().sync.lastSyncedBlock).toBe('0x64');
    expect(saved().sync.relayerRegistrySyncedBlock).toBe('0x1f4');
  });
});
