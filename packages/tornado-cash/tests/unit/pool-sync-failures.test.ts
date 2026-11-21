import { describe, expect, it, vi } from 'vitest';

import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager, Secret } from '../../src/account/keys';
import { TornadoCashConfigs } from '../../src/config';
import type { IDataService, IPoolConfig } from '../../src/data/interfaces/data.service.interface';
import type { IGetEventsParams, ISyncService } from '../../src/data/interfaces/sync.service.interface';
import type { Address, Commitment, Nullifier, NullifierHash } from '../../src/interfaces/types.interface';
import type { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { storeStateManager } from '../../src/state/state-manager';
import type { ITornadoProver } from '../../src/utils/tornado-prover';

// The root check has its own tests (sync-events-root-check); here every pool that is fetched passes it.
vi.mock('../../src/verification/root-verification', async (importOriginal) => {
  const { emptyFrontier } = await import('../../src/utils/merkle-frontier');

  return {
    ...await importOriginal<object>(),
    verifyPoolLeavesAt: vi.fn(async () => ({ root: 0n, frontier: emptyFrontier() })),
  };
});

// Real mainnet instances, since synced pools are restricted to the instance catalog.
const ETH_1 = 0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936n as Address;
const ETH_01 = 0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fcn as Address;
const ETH = 10n ** 18n;
const DENOMINATIONS = new Map([[ETH_1, ETH], [ETH_01, ETH / 10n]]);

const poolConfig = (poolAddress: Address): IPoolConfig => ({
  poolAddress,
  isERC20: false,
  token: 0n,
  state: 1,
  protocolFeePercentage: 0,
  denomination: DENOMINATIONS.get(poolAddress)!,
  rootHistorySize: 100,
});

// The user's first signature note in each pool has commitment pool + 1.
const secretManager: ISecretManager = {
  getSignatureSecrets: async ({ nonce, poolAddress }) => ({
    nullifier: 1n as Nullifier,
    salt: 2n,
    commitment: (poolAddress + BigInt(nonce) + 1n) as Commitment,
    nullifierHash: (poolAddress + BigInt(nonce)) as NullifierHash,
  } satisfies Secret),
  getLegacyDepositSecrets: async () => ({
    nullifier: 1n as Nullifier, salt: 2n, commitment: 0n as Commitment, nullifierHash: 0n as NullifierHash,
  }),
} as unknown as ISecretManager;

const depositIn = (pool: Address) => ({
  commitment: (pool + 1n) as Commitment,
  leafIndex: 0,
  timestamp: 1n,
  blockNumber: 150n,
  transactionHash: 1n,
});

function createStorage() {
  const saved = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string) => { saved.set(key, value); });

  return {
    storage: { _brand: 'Storage', get: async (key: string) => saved.get(key), set } as unknown as Storage,
    set,
    saved: () => JSON.parse([...saved.values()][0]!),
  };
}

/** Both pools sync, except those the test marks as failing, which throw on the named call. */
function setup({ failConfig = new Set<Address>(), failEvents = new Set<Address>() } = {}) {
  const { storage, set, saved } = createStorage();
  const getPoolEvents = vi.fn(async ({ address }: IGetEventsParams) => {
    if (failEvents.has(address)) throw new Error('provider unavailable');

    return { Deposited: [depositIn(address)], Withdrawn: [], toBlock: 200n };
  });
  const dataService = {
    getChainId: async () => 1n,
    getBlockNumber: async () => 200n,
    getFinalizedBlockNumber: async () => 200n,
    getAllPoolsAddresses: async () => [ETH_1, ETH_01],
    getAsset: async (address: Address) => ({ address, name: 'Ether', symbol: 'ETH', decimals: 18 }),
    getPoolConfig: async (_registry: Address, address: Address) => {
      if (failConfig.has(address)) throw new Error('rpc timeout');

      return poolConfig(address);
    },
  } as unknown as IDataService;
  const syncService = {
    getPoolDeploymentBlock: async () => 100n,
    getPoolEvents,
  } as unknown as ISyncService;

  const manager = storeStateManager({
    dataService,
    syncService,
    secretManagerFactory: async () => secretManager,
    proverFactory: async () => ({}) as ITornadoProver,
    relayerClient: {} as IRelayerClient,
    paymasterConfig: {},
    storageToSyncTo: storage,
    protocolConfig: { ...TornadoCashConfigs[1], instances: undefined },
  });

  return { manager, set, saved, getPoolEvents, failConfig, failEvents };
}

const poolCursor = (state: { pools: { poolsTuples: [string, { lastSyncedBlock?: string }][] } }, pool: Address) =>
  state.pools.poolsTuples.find(([address]) => BigInt(address) === pool)?.[1].lastSyncedBlock;

describe('pool sync failures through the state manager (F-27)', () => {
  it('rejects when a pool event scan fails, keeping the healthy pool progress', async () => {
    const { manager, saved, failEvents } = setup({ failEvents: new Set([ETH_01]) });
    const stateManager = await manager;

    await expect(stateManager.sync()).rejects.toMatchObject({
      name: 'TornadoPoolSyncError',
      message: expect.stringContaining('0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc'),
    });

    // The healthy pool's events and cursor were persisted, and its note discovered...
    expect(poolCursor(saved(), ETH_1)).toBe('0xc8');
    expect(await stateManager.getNotes({})).toHaveLength(1);
    // ...but the failed pool's cursor and the global cursor did not move.
    expect(poolCursor(saved(), ETH_01)).toBeUndefined();
    expect(saved().sync.lastSyncedBlock).toBe('0');

    failEvents.clear();
    await stateManager.sync();

    expect(poolCursor(saved(), ETH_01)).toBe('0xc8');
    expect(saved().sync.lastSyncedBlock).toBe('0xc8');
    expect(await stateManager.getBalances()).toEqual(new Map([[0n, ETH + ETH / 10n]]));
  });

  it('rejects when a pool metadata fetch fails, and registers that pool on the next sync', async () => {
    const { manager, saved, getPoolEvents, failConfig } = setup({ failConfig: new Set([ETH_01]) });
    const stateManager = await manager;

    await expect(stateManager.sync()).rejects.toMatchObject({
      name: 'TornadoPoolSyncError',
      message: expect.stringContaining('0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc'),
    });

    expect(poolCursor(saved(), ETH_1)).toBe('0xc8');
    expect(poolCursor(saved(), ETH_01)).toBeUndefined();
    expect(saved().sync.lastSyncedBlock).toBe('0');
    expect(getPoolEvents).toHaveBeenCalledTimes(1);

    failConfig.clear();
    await stateManager.sync();

    expect(poolCursor(saved(), ETH_01)).toBe('0xc8');
    expect(saved().sync.lastSyncedBlock).toBe('0xc8');
  });

  it('does not save state when sync fails for a reason other than pool coverage', async () => {
    const { manager, set } = setup();
    const stateManager = await manager;

    vi.spyOn(secretManager, 'getSignatureSecrets').mockRejectedValueOnce(new Error('signer locked'));

    await expect(stateManager.sync()).rejects.toMatchObject({ message: 'signer locked' });
    expect(set).not.toHaveBeenCalled();
  });
});
