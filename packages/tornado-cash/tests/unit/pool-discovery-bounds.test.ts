import { describe, expect, it, vi } from 'vitest';

import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager } from '../../src/account/keys';
import { TornadoCashConfigs } from '../../src/config';
import type { IDataService, IPoolConfig } from '../../src/data/interfaces/data.service.interface';
import type { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import type { Address, Commitment, Nullifier, NullifierHash } from '../../src/interfaces/types.interface';
import type { ITornadoInstance } from '../../src/instances';
import type { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { storeStateManager } from '../../src/state/state-manager';
import { MAX_REGISTRY_POOLS } from '../../src/state/thunks/syncPoolsThunk';
import { allSettledLimited, POOL_CONCURRENCY } from '../../src/utils/settle-limited';
import type { ITornadoProver } from '../../src/utils/tornado-prover';

// The root check has its own tests (sync-events-root-check); here every pool that is fetched passes it.
vi.mock('../../src/verification/root-verification', async (importOriginal) => {
  const { emptyFrontier } = await import('../../src/utils/merkle-frontier');

  return {
    ...await importOriginal<object>(),
    verifyPoolLeavesAt: vi.fn(async () => ({ root: 0n, frontier: emptyFrontier() })),
  };
});

// A chain with no built-in instance catalog, so every registry address is kept.
const CHAIN_ID = 31337n;

const poolsAt = (count: number) => Array.from({ length: count }, (_, i) => (0x1000n + BigInt(i)) as Address);

const poolConfig = (poolAddress: Address): IPoolConfig => ({
  poolAddress,
  isERC20: false,
  token: 0n,
  state: 1,
  protocolFeePercentage: 0,
  denomination: 10n ** 18n,
  rootHistorySize: 100,
});

const secretManager = {
  getSignatureSecrets: async ({ nonce, poolAddress }: { nonce: number; poolAddress: Address }) => ({
    nullifier: 1n as Nullifier,
    salt: 2n,
    commitment: (poolAddress + BigInt(nonce) + 1n) as Commitment,
    nullifierHash: (poolAddress + BigInt(nonce)) as NullifierHash,
  }),
  getLegacyDepositSecrets: async () => ({
    nullifier: 1n as Nullifier, salt: 2n, commitment: 0n as Commitment, nullifierHash: 0n as NullifierHash,
  }),
} as unknown as ISecretManager;

/** Tracks the most calls of a fake that were pending at once. */
function inFlight<A extends unknown[], R>(fn: (...args: A) => R) {
  let pending = 0;
  const tracker = {
    peak: 0,
    fn: vi.fn(async (...args: A) => {
      pending++;
      tracker.peak = Math.max(tracker.peak, pending);
      await new Promise((resolve) => setTimeout(resolve, 1));
      pending--;

      return fn(...args);
    }),
  };

  return tracker;
}

function setup(registry: Address[], instances?: readonly ITornadoInstance[]) {
  const saved = new Map<string, string>();
  const storage = {
    _brand: 'Storage',
    get: async (key: string) => saved.get(key),
    set: async (key: string, value: string) => { saved.set(key, value); },
  } as unknown as Storage;
  const getPoolConfig = inFlight((_registry: Address, address: Address) => poolConfig(address));
  const getPoolEvents = inFlight(() => ({ Deposited: [], Withdrawn: [], toBlock: 200n }));

  const dataService = {
    getChainId: async () => CHAIN_ID,
    getBlockNumber: async () => 200n,
    getFinalizedBlockNumber: async () => 200n,
    getAllPoolsAddresses: async () => registry,
    getAsset: async (address: Address) => ({ address, name: 'Ether', symbol: 'ETH', decimals: 18 }),
    getPoolConfig: getPoolConfig.fn,
  } as unknown as IDataService;
  const syncService = {
    getPoolDeploymentBlock: async () => 100n,
    getPoolEvents: getPoolEvents.fn,
  } as unknown as ISyncService;

  const manager = storeStateManager({
    dataService,
    syncService,
    secretManagerFactory: async () => secretManager,
    proverFactory: async () => ({}) as ITornadoProver,
    relayerClient: {} as IRelayerClient,
    paymasterConfig: {},
    storageToSyncTo: storage,
    protocolConfig: { ...TornadoCashConfigs[1], instances },
  });

  return { manager, getPoolConfig, getPoolEvents };
}

describe('pool discovery bounds (F-7)', () => {
  it('refuses a registry listing more pools than allowed, before fetching any of them', async () => {
    const { manager, getPoolConfig, getPoolEvents } = setup(poolsAt(MAX_REGISTRY_POOLS + 1));

    await expect((await manager).sync()).rejects.toThrow(
      `Instance registry lists ${MAX_REGISTRY_POOLS + 1} pools, more than the ${MAX_REGISTRY_POOLS} allowed`,
    );
    expect(getPoolConfig.fn).not.toHaveBeenCalled();
    expect(getPoolEvents.fn).not.toHaveBeenCalled();
  });

  it('does not cap a registry when a catalog selects the pools to fetch', async () => {
    const registry = poolsAt(MAX_REGISTRY_POOLS + 1);
    const selected = registry[MAX_REGISTRY_POOLS]!;
    const { manager, getPoolConfig, getPoolEvents } = setup(registry, [
      { address: selected, asset: 0n, symbol: 'ETH', decimals: 18, denomination: 10n ** 18n },
    ]);

    await expect((await manager).sync()).resolves.toBeUndefined();

    expect(getPoolConfig.fn).toHaveBeenCalledOnce();
    expect(getPoolConfig.fn).toHaveBeenCalledWith(expect.anything(), selected);
    expect(getPoolEvents.fn).toHaveBeenCalledOnce();
  });

  it('fetches and scans every pool, at most POOL_CONCURRENCY at once', async () => {
    const pools = poolsAt(5 * POOL_CONCURRENCY);
    const { manager, getPoolConfig, getPoolEvents } = setup(pools);

    await expect((await manager).sync()).resolves.toBeUndefined();

    expect(getPoolConfig.fn).toHaveBeenCalledTimes(pools.length);
    expect(getPoolEvents.fn).toHaveBeenCalledTimes(pools.length);
    expect(getPoolConfig.peak).toBe(POOL_CONCURRENCY);
    expect(getPoolEvents.peak).toBe(POOL_CONCURRENCY);
  });
});

describe('allSettledLimited', () => {
  it('settles every item in input order', async () => {
    const results = await allSettledLimited([3, 1, 2, 0], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));

      if (n === 2) throw new Error('two');

      return n * 10;
    });

    expect(results).toEqual([
      { status: 'fulfilled', value: 30 },
      { status: 'fulfilled', value: 10 },
      { status: 'rejected', reason: new Error('two') },
      { status: 'fulfilled', value: 0 },
    ]);
  });

  it('resolves to an empty list for no items', async () => {
    await expect(allSettledLimited([], 8, async () => 1)).resolves.toEqual([]);
  });
});
