import { describe, expect, it, vi } from 'vitest';
import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { storeStateManager } from '../../src/state/state-manager';
import { getPPv1ChainStateKey, getPPv1TimestampsKey } from '../../src/state/storage-keys';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const entrypoint = { address: 900n as Address, deploymentBlock: 100n };

/** A chain with no pools and no deposits. */
const emptyChain = () => ({
  getChainId: vi.fn(async () => 1n),
  getBlockNumber: vi.fn(async () => 200n),
  getEntrypointEvents: vi.fn(async ({ events }: { events: string[] }) => Object.fromEntries(events.map((name) => [name, []]))),
  getBlockTimestamp: vi.fn(async (block: bigint) => block * 12n),
});

const memoryStorage = () => {
  const map = new Map<string, string>();

  return { map, _brand: 'Storage', get: async (key: string) => map.get(key) ?? null, set: async (key: string, value: string) => { map.set(key, value); } };
};

const setupManager = (storage: ReturnType<typeof memoryStorage>, dataService = emptyChain()) => storeStateManager({
  dataService: dataService as unknown as IDataService,
  secretManager: { getDepositSecrets: async () => ({ nullifier: 1n, salt: 2n, precommitment: 999n, nullifierHash: 5n }) } as unknown as ISecretManager,
  aspService: {} as IAspService,
  entrypoint,
  storageToSyncTo: storage as unknown as Storage,
  devOptions: TEST_STORE_DEV_OPTIONS,
} as never);

describe('storage keys', () => {
  it('names the key the chain state is stored under', async () => {
    const { map, ...storage } = memoryStorage();
    const manager = setupManager({ map, ...storage });

    await manager.sync();

    expect(map.has(getPPv1ChainStateKey(1n, entrypoint.address))).toBe(true);
    // Dumps and snapshots keep the key without the storage version.
    expect(Object.keys(manager.dumpState())).toEqual([`privacy-pool-state-1-${entrypoint.address}`]);
  });

  it('saves only keys every account shares', async () => {
    const storage = memoryStorage();
    const accounts = [setupManager(storage), setupManager(storage)];

    for (const account of accounts) {
      await account.sync();
      await account.getHistory({});
    }

    expect([...storage.map.keys()].sort()).toEqual([
      getPPv1ChainStateKey(1n, entrypoint.address),
      getPPv1TimestampsKey(1n, entrypoint.address),
    ].sort());
  });

  it('ignores a state saved under the unversioned key', async () => {
    const storage = memoryStorage();
    const dataService = emptyChain();

    storage.map.set(`privacy-pool-state-1-${entrypoint.address}`, JSON.stringify({ sync: { lastSyncedBlock: '0xbb8' } }));
    await setupManager(storage, dataService).sync();

    expect(dataService.getEntrypointEvents.mock.calls[0]![0]).toMatchObject({ fromBlock: entrypoint.deploymentBlock });
  });
});
