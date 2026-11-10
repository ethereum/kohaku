import { describe, expect, it, vi } from 'vitest';
import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { storeStateManager } from '../../src/state/state-manager';
import { addNoteSecrets, addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { storeFactory } from '../../src/state/store';
import { deserialize } from '../../src/state/utils/serialize.utils';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';
import { createMockHost } from '../utils/mock-host';

const entrypoint = { address: 900n as Address, deploymentBlock: 100n };
const asset = { contract: '0x00000000000000000000000000000000000007d0', __type: 'erc20' } as const;

const noteSecret = (noteIndex: number) => ({
  noteIndex,
  nullifier: BigInt(noteIndex),
  salt: 0n,
  precommitment: 1n,
  nullifierHash: 100n + BigInt(noteIndex),
});

/** A chain with no pools: a sync only reads the head and scans the entrypoint. */
const emptyChainDataService = () => ({
  getChainId: vi.fn(async () => 1n),
  getBlockNumber: vi.fn(async () => 200n),
  getEntrypointEvents: vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock: bigint }) => ({
    ...Object.fromEntries(events.map((name) => [name, []])),
    fromBlock,
    toBlock,
  })),
});

/** Storage whose reads take a tick, like any real backend. */
const asyncStorage = () => {
  const map = new Map<string, string>();

  return {
    _brand: 'Storage',
    get: vi.fn(async (key: string) => {
      await Promise.resolve();

      return map.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
  };
};

const setupManager = (dataService = emptyChainDataService(), storage = asyncStorage()) => ({
  dataService,
  storage,
  manager: storeStateManager({
    dataService: dataService as unknown as IDataService,
    secretManager: {
      getDepositSecrets: async () => ({ nullifier: 1n, salt: 2n, precommitment: 999n, nullifierHash: 5n }),
    } as unknown as ISecretManager,
    aspService: {} as IAspService,
    entrypoint,
    storageToSyncTo: storage as unknown as Storage,
    devOptions: TEST_STORE_DEV_OPTIONS,
  } as never),
});

/** Holds the first head lookup until released, so a sync can be kept running. */
const holdFirstHead = (dataService: ReturnType<typeof emptyChainDataService>, heads: bigint[]) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let call = 0;

  dataService.getBlockNumber.mockImplementation(async () => {
    const head = heads[Math.min(call++, heads.length - 1)]!;

    if (call === 1) await released;

    return head;
  });

  return release;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('storeStateManager.sync', () => {
  it('runs the first sync and one follow-up for a burst of calls', async () => {
    const { manager, dataService, storage } = setupManager();

    await Promise.all([manager.sync(), manager.sync(), manager.sync()]);

    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(2);
    // One store was loaded: the state and history keys were each read once.
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it('runs a new sync once the previous one has finished', async () => {
    const { manager, dataService } = setupManager();

    await manager.sync();
    await manager.sync();

    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it('answers a call made during a sync with a later sync, which sees a newer head', async () => {
    const { manager, dataService } = setupManager();
    const release = holdFirstHead(dataService, [200n, 201n]);

    const first = manager.sync();

    await vi.waitFor(() => expect(dataService.getBlockNumber).toHaveBeenCalledTimes(1));

    const second = manager.sync();

    await flush();
    // The second call did not start a sync that overlaps the running one.
    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);

    expect(dataService.getEntrypointEvents.mock.calls.map(([{ toBlock }]) => toBlock)).toEqual([200n, 201n]);
  });

  it('shares one follow-up between every call made during a sync', async () => {
    const { manager, dataService } = setupManager();
    const release = holdFirstHead(dataService, [200n, 201n]);

    const first = manager.sync();

    await vi.waitFor(() => expect(dataService.getBlockNumber).toHaveBeenCalledTimes(1));

    const followUps = [manager.sync(), manager.sync(), manager.sync()];

    await flush();
    release();
    await Promise.all([first, ...followUps]);

    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it('runs the follow-up even when the running sync fails', async () => {
    const { manager, dataService } = setupManager();

    dataService.getBlockNumber.mockRejectedValueOnce(new Error('rpc down'));

    const results = await Promise.allSettled([manager.sync(), manager.sync()]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'fulfilled']);
    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it('retries loading the store after a storage failure', async () => {
    const storage = asyncStorage();
    const { manager } = setupManager(emptyChainDataService(), storage);

    storage.get.mockRejectedValueOnce(new Error('storage down'));

    await expect(manager.sync()).rejects.toThrow('storage down');
    await expect(manager.sync()).resolves.toBeUndefined();
  });
});

describe('view options', () => {
  const setupPlugin = () => {
    const stateManager = {
      sync: vi.fn(async () => {}),
      getBalances: vi.fn(async () => new Map()),
      getNotes: vi.fn(async () => []),
      getHistory: vi.fn(async () => []),
    };
    const plugin = new PrivacyPoolsV1Protocol(createMockHost(), {
      entrypoint,
      dataService: {} as IDataService,
      stateManager: () => stateManager as unknown as IStateManager,
    });

    return { plugin, stateManager };
  };

  it('syncs before reading by default', async () => {
    const { plugin, stateManager } = setupPlugin();

    await plugin.balance([asset]);
    await plugin.notes([asset]);
    await plugin.history([asset]);

    expect(stateManager.sync).toHaveBeenCalledTimes(3);
  });

  it('reads the last synced state with sync: false', async () => {
    const { plugin, stateManager } = setupPlugin();

    await plugin.balance([asset], { sync: false });
    await plugin.notes([asset], true, { sync: false });
    await plugin.history([asset], { sync: false });

    expect(stateManager.sync).not.toHaveBeenCalled();
    expect(stateManager.getBalances).toHaveBeenCalledTimes(1);
    expect(stateManager.getNotes).toHaveBeenCalledWith({ includeSpent: true, assets: [BigInt(asset.contract)] });
    // History still refreshes its timestamps, which happens inside getHistory.
    expect(stateManager.getHistory).toHaveBeenCalledTimes(1);
  });
});

describe('addNoteSecrets', () => {
  it('ignores note indexes the record already holds', () => {
    const store = storeFactory({
      logLevel: 'off',
      devOptions: TEST_STORE_DEV_OPTIONS,
      entrypointInfo: { chainId: 1n, entrypointAddress: entrypoint.address, deploymentBlock: entrypoint.deploymentBlock },
    });

    store.dispatch(addUserSecret({ depositIndex: 0, noteSecrets: [noteSecret(0)] }));
    // Two discoveries of the same change note, as interleaved syncs would produce.
    store.dispatch(addNoteSecrets({ precommitment: 1n as never, noteSecrets: [noteSecret(1)] }));
    store.dispatch(addNoteSecrets({ precommitment: 1n as never, noteSecrets: [noteSecret(1), noteSecret(2)] }));

    const [[, record]] = deserialize(store.getState().userSecrets.recordsByPrecommitment) as [bigint, { noteSecrets: { noteIndex: number }[] }][];

    expect(record!.noteSecrets.map(({ noteIndex }) => noteIndex)).toEqual([0, 1, 2]);
  });
});
