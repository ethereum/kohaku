import { unwrapResult } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';

import { ISecretManager, Secret } from '../../src/account/keys';
import { ExtendedEthPools } from '../../src/config';
import { TornadoInstances } from '../../src/instances';
import { IDataService, IPoolConfig } from '../../src/data/interfaces/data.service.interface';
import { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import { IPool } from '../../src/data/interfaces/events.interface';
import { Address, Commitment, Nullifier, NullifierHash } from '../../src/interfaces/types.interface';
import { addressToHex } from '../../src/utils';
import { poolsSelector } from '../../src/state/selectors/slices.selectors';
import { setProtocolConfig } from '../../src/state/slices/protocolConfigSlice';
import { ProtocolConfigState } from '../../src/state/slices/protocolConfigSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { setLastSyncedBlock } from '../../src/state/slices/syncSlice';
import { storeFactory } from '../../src/state/store';
import { DepositStrategy, getDepositPayloadThunk } from '../../src/state/thunks/getDepositPayloadThunk';
import { syncEventsThunk } from '../../src/state/thunks/syncEventsThunk';
import { syncPoolsThunk } from '../../src/state/thunks/syncPoolsThunk';

// Deposits and synced pools are restricted to the instance catalog, so these are real mainnet instances.
const CLASSIC = 0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936n as Address; // 1 ETH
const EXTENDED = ExtendedEthPools[1][0] as Address;
const EXTENDED_003 = ExtendedEthPools[1][1] as Address;
const ETH = 10n ** 18n;

const catalogDenomination = (address: Address) =>
  TornadoInstances[1].find((instance) => instance.address === address)!.denomination;

function protocolConfig(useExtendedEthPools = false): ProtocolConfigState {
  return {
    chainId: 1n,
    ensSubdomainKey: 'eth',
    instanceRegistry: { address: 1n, deploymentBlock: 0n },
    relayerRegistry: { address: 2n, deploymentBlock: 0n },
    aggregator: { address: 3n },
    useExtendedEthPools,
  };
}

function storeWith(useExtendedEthPools = false) {
  return storeFactory({
    protocolConfig: protocolConfig(useExtendedEthPools),
    logLevel: 'off',
  });
}

function pool(
  address: Address,
  denomination: bigint,
  registeredBlock = 0n,
  lastSyncedBlock?: bigint,
  extended = false,
): IPool {
  return {
    address,
    asset: 0n,
    isERC20: false,
    protocolFeePercentage: 0,
    denomination,
    registeredBlock,
    state: 1,
    rootHistorySize: 100,
    ...(lastSyncedBlock === undefined ? {} : { lastSyncedBlock }),
    ...(extended ? { extended } : {}),
  };
}

function registryConfig(address: Address, denomination: bigint): IPoolConfig {
  return {
    poolAddress: address,
    isERC20: false,
    token: 0n,
    state: 1,
    protocolFeePercentage: 33,
    denomination,
    rootHistorySize: 30,
  };
}

function secretManager(): ISecretManager {
  const asSecret = (commitment: bigint): Secret => ({
    nullifier: 1n as Nullifier,
    salt: 2n,
    commitment: commitment as Commitment,
    nullifierHash: 3n as NullifierHash,
  });

  return {
    getSignatureSecrets: async ({ nonce, poolAddress }) => asSecret(BigInt(nonce) + poolAddress),
    getLegacyDepositSecrets: async () => asSecret(1n),
    deriveSignatureEphemeralSigner: async () => `0x${'11'.repeat(32)}`,
    deriveEphemeralSigner: async () => `0x${'22'.repeat(32)}`,
    deriveDelegatorSigner: async () => `0x${'33'.repeat(32)}`,
    deriveLegacyEphemeralSigner: async () => `0x${'44'.repeat(32)}`,
  };
}

describe('syncPoolsThunk extended ETH pools', () => {
  it.each([false, true])('filters uncatalogued pools, warning only for the default catalog (custom: %s)', async (custom) => {
    const store = storeWith();
    const unknown = 123n as Address;
    const dataService = {
      getAllPoolsAddresses: vi.fn().mockResolvedValue([CLASSIC, unknown]),
      getPoolConfig: vi.fn().mockResolvedValue(registryConfig(CLASSIC, ETH)),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      unwrapResult(await store.dispatch(syncPoolsThunk({
        dataService: dataService as unknown as IDataService,
        syncService: { getPoolDeploymentBlock: vi.fn().mockResolvedValue(10n) } as unknown as ISyncService,
        ...(custom ? { instances: TornadoInstances[1].filter((instance) => instance.address === CLASSIC) } : {}),
      })));
      expect(dataService.getPoolConfig).toHaveBeenCalledTimes(1);
      expect(dataService.getPoolConfig).toHaveBeenCalledWith(1n, CLASSIC);
      expect(poolsSelector(store.getState()).has(unknown)).toBe(false);
      expect(poolsSelector(store.getState()).has(CLASSIC)).toBe(true);
      if (custom) expect(warn).not.toHaveBeenCalled();
      else expect(warn).toHaveBeenCalledWith('Ignoring pools missing from the instance catalog', [addressToHex(unknown)]);
    } finally {
      warn.mockRestore();
    }
  });

  it('registers an extended pool missing from the registry as native ETH', async () => {
    const store = storeWith(true);
    const dataService = {
      getAllPoolsAddresses: vi.fn().mockResolvedValue([CLASSIC]),
      getPoolConfig: vi.fn().mockResolvedValue(registryConfig(CLASSIC, ETH)),
      getUnregisteredNativeEthPoolConfig: vi.fn(async (address: Address) => ({
        ...registryConfig(address, catalogDenomination(address)),
        protocolFeePercentage: 0,
        rootHistorySize: 100,
      })),
    };
    const syncService = {
      getPoolDeploymentBlock: vi.fn().mockImplementation(async ({ address }: { address: Address }) => (
        address === EXTENDED ? 40n : 10n
      )),
    };

    unwrapResult(await store.dispatch(syncPoolsThunk({
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    })));

    expect(dataService.getPoolConfig).toHaveBeenCalledTimes(1);
    expect(dataService.getPoolConfig).toHaveBeenCalledWith(1n, CLASSIC);
    expect(dataService.getUnregisteredNativeEthPoolConfig).toHaveBeenCalledTimes(ExtendedEthPools[1].length);
    expect(dataService.getUnregisteredNativeEthPoolConfig).toHaveBeenCalledWith(EXTENDED);

    const pools = poolsSelector(store.getState());
    const extended = pools.get(EXTENDED);

    expect(extended).toMatchObject({
      asset: 0n,
      isERC20: false,
      denomination: ETH / 100n,
      protocolFeePercentage: 0,
      state: 1,
      registeredBlock: 40n,
      rootHistorySize: 100,
      extended: true,
    });
    expect(pools.get(CLASSIC)?.extended).toBeUndefined();
  });

  it('uses the registry record when the extended pool is already listed', async () => {
    const store = storeWith(true);
    const dataService = {
      getAllPoolsAddresses: vi.fn().mockResolvedValue([EXTENDED]),
      getPoolConfig: vi.fn().mockResolvedValue(registryConfig(EXTENDED, ETH / 100n)),
      getUnregisteredNativeEthPoolConfig: vi.fn(async (address: Address) => ({
        ...registryConfig(address, catalogDenomination(address)),
        protocolFeePercentage: 0,
      })),
    };
    const syncService = {
      getPoolDeploymentBlock: vi.fn().mockResolvedValue(7n),
    };

    unwrapResult(await store.dispatch(syncPoolsThunk({
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    })));

    expect(dataService.getPoolConfig).toHaveBeenCalledTimes(1);
    expect(dataService.getPoolConfig).toHaveBeenCalledWith(1n, EXTENDED);
    expect(dataService.getUnregisteredNativeEthPoolConfig).not.toHaveBeenCalledWith(EXTENDED);
    expect(dataService.getUnregisteredNativeEthPoolConfig).toHaveBeenCalledTimes(ExtendedEthPools[1].length - 1);
    expect(poolsSelector(store.getState()).get(EXTENDED)?.protocolFeePercentage).toBe(33);
  });

  it('does not register extended pools unless opted in', async () => {
    const store = storeWith();
    const dataService = {
      getAllPoolsAddresses: vi.fn().mockResolvedValue([CLASSIC, EXTENDED]),
      getPoolConfig: vi.fn().mockResolvedValue(registryConfig(CLASSIC, ETH)),
      getUnregisteredNativeEthPoolConfig: vi.fn(),
    };
    const syncService = {
      getPoolDeploymentBlock: vi.fn().mockResolvedValue(10n),
    };

    unwrapResult(await store.dispatch(syncPoolsThunk({
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    })));

    expect(dataService.getPoolConfig).toHaveBeenCalledTimes(1);
    expect(dataService.getPoolConfig).toHaveBeenCalledWith(1n, CLASSIC);
    expect(dataService.getUnregisteredNativeEthPoolConfig).not.toHaveBeenCalled();
    expect(syncService.getPoolDeploymentBlock).toHaveBeenCalledTimes(1);
    expect(poolsSelector(store.getState()).has(EXTENDED)).toBe(false);
    expect(poolsSelector(store.getState()).has(CLASSIC)).toBe(true);
  });

  it('stamps extended on a saved pool without refetching it', async () => {
    const store = storeWith();

    store.dispatch(registerPools([pool(EXTENDED, ETH / 100n, 50n, 80n)]));

    const dataService = {
      getAllPoolsAddresses: vi.fn().mockResolvedValue([]),
      getPoolConfig: vi.fn(),
      getUnregisteredNativeEthPoolConfig: vi.fn(),
    };
    const syncService = {
      getPoolDeploymentBlock: vi.fn(),
    };

    unwrapResult(await store.dispatch(syncPoolsThunk({
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    })));

    const saved = poolsSelector(store.getState()).get(EXTENDED);

    expect(saved?.extended).toBe(true);
    expect(saved?.lastSyncedBlock).toBe(80n);
    expect(dataService.getPoolConfig).not.toHaveBeenCalled();
    expect(dataService.getUnregisteredNativeEthPoolConfig).not.toHaveBeenCalled();
    expect(syncService.getPoolDeploymentBlock).not.toHaveBeenCalled();
  });
});

describe('syncEventsThunk extended ETH pool cursors', () => {
  function eventsService() {
    const calls: { address: Address; fromBlock: bigint }[] = [];
    const syncService = {
      getPoolEvents: vi.fn(async ({ address, fromBlock }: { address: Address; fromBlock: bigint }) => {
        calls.push({ address, fromBlock });

        return { Deposited: [], Withdrawn: [], toBlock: fromBlock };
      }),
    };

    return { calls, syncService: syncService as unknown as ISyncService };
  }

  it('syncs a pool with no cursor from its registered block, not the global cursor', async () => {
    const store = storeWith(true);

    store.dispatch(setLastSyncedBlock(9_000n));
    store.dispatch(registerPools([
      pool(CLASSIC, ETH, 10n),
      pool(EXTENDED, ETH / 100n, 50n, undefined, true),
    ]));

    const { calls, syncService } = eventsService();

    unwrapResult(await store.dispatch(syncEventsThunk({ syncService })));

    expect(calls).toEqual([
      { address: CLASSIC, fromBlock: 10n },
      { address: EXTENDED, fromBlock: 50n },
    ]);
  });

  it('freezes an ignored pool cursor and resumes from it when extended pools are enabled again', async () => {
    const store = storeWith(true);

    store.dispatch(setLastSyncedBlock(5_000n));
    store.dispatch(registerPools([
      pool(CLASSIC, ETH, 10n, 200n),
      pool(EXTENDED, ETH / 100n, 50n, 80n, true),
    ]));
    store.dispatch(setProtocolConfig(protocolConfig(false)));

    const ignored = eventsService();

    unwrapResult(await store.dispatch(syncEventsThunk({ syncService: ignored.syncService })));

    expect(ignored.calls).toEqual([{ address: CLASSIC, fromBlock: 200n }]);
    expect(poolsSelector(store.getState()).get(EXTENDED)?.lastSyncedBlock).toBe(80n);

    store.dispatch(setProtocolConfig(protocolConfig(true)));

    const resumed = eventsService();

    unwrapResult(await store.dispatch(syncEventsThunk({ syncService: resumed.syncService })));

    expect(resumed.calls).toEqual([
      { address: CLASSIC, fromBlock: 200n },
      { address: EXTENDED, fromBlock: 80n },
    ]);
  });
});

describe('deposit denomination packing', () => {
  const classicPointOne = 0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fcn as Address; // 0.1 ETH

  async function deposit(amount: bigint, strategy: DepositStrategy, useExtendedEthPools = true) {
    const store = storeWith(useExtendedEthPools);

    store.dispatch(registerPools([
      pool(classicPointOne, ETH / 10n),
      pool(EXTENDED, ETH / 100n, 0n, undefined, true),
      pool(EXTENDED_003, (ETH / 100n) * 3n, 0n, undefined, true),
    ]));

    return unwrapResult(await store.dispatch(getDepositPayloadThunk({
      secretManager: secretManager(),
      asset: 0n,
      amount,
      strategy,
    })));
  }

  it('packs 0.13 ETH as 0.1 plus 0.03 with MinFee', async () => {
    const txs = await deposit((ETH / 100n) * 13n, DepositStrategy.MinFee);
    const values = txs.map((tx) => tx.value).sort((a, b) => (a < b ? -1 : 1));

    expect(values).toEqual([(ETH / 100n) * 3n, ETH / 10n]);
  });

  it('keeps MaxAnonimitySet on the 0.1 ETH pool when 0.01 is available', async () => {
    const txs = await deposit(ETH / 5n, DepositStrategy.MaxAnonimitySet);

    expect(txs).toHaveLength(2);
    expect(txs.every((tx) => tx.value === ETH / 10n && tx.to === addressToHex(classicPointOne))).toBe(true);
  });
});
