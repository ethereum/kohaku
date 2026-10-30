import { unwrapResult } from '@reduxjs/toolkit';
import { decodeFunctionData, erc20Abi } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import type { Storage } from '@kohaku-eth/plugins';
import { ISecretManager, Secret } from '../../src/account/keys';
import { ExtendedEthPools, TornadoCashConfigs, TornadoPaymasterConfigs } from '../../src/config';
import { IDataService, IPoolConfig } from '../../src/data/interfaces/data.service.interface';
import { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import { IPool } from '../../src/data/interfaces/events.interface';
import { catalogInstanceFor, instanceCatalog, ITornadoInstance, TornadoInstances } from '../../src/instances';
import { Address, Commitment, Nullifier, NullifierHash } from '../../src/interfaces/types.interface';
import { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { poolsSelector } from '../../src/state/selectors/slices.selectors';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeStateManager } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';
import { DepositStrategy, getDepositPayloadThunk } from '../../src/state/thunks/getDepositPayloadThunk';
import { syncPoolsThunk } from '../../src/state/thunks/syncPoolsThunk';
import sepoliaSnapshot from '../../src/state/initial-states/state.11155111.minimal.json';
import { addressToHex } from '../../src/utils';
import { ITornadoProver } from '../../src/utils/tornado-prover';

const DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0Fn as Address;
const DAI_100 = 0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3n as Address;
const DAI_1000 = 0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144n as Address;
const FAKE_POOL = 0xdEaDn as Address;
const ONE_DAI = 10n ** 18n;

function storeOn(chainId = 1n) {
  return storeFactory({ protocolConfig: { ...TornadoCashConfigs[1], chainId }, logLevel: 'off' });
}

function daiPool(address: Address, denomination: bigint): IPool {
  return {
    address,
    asset: DAI,
    isERC20: true,
    protocolFeePercentage: 0,
    denomination,
    registeredBlock: 0n,
    state: 1,
    rootHistorySize: 100,
  };
}

function daiConfig(address: Address, denomination: bigint): IPoolConfig {
  return { poolAddress: address, isERC20: true, token: DAI, state: 1, protocolFeePercentage: 0, denomination, rootHistorySize: 100 };
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

/** Every address a deposit sends funds to: tx targets and ERC-20 approve spenders. */
function depositTargets(txns: { to: string; data: string }[]): string[] {
  return txns.map((tx) => {
    if (tx.to.toLowerCase() === addressToHex(DAI)) {
      const { args: [spender] } = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` }) as { args: [string, bigint] };

      return spender.toLowerCase();
    }

    return tx.to.toLowerCase();
  });
}

describe('instance catalog', () => {
  it('lists every extended, paymaster and shipped-snapshot pool with matching chain', () => {
    for (const chainId of [1, 11155111] as const) {
      const catalog = instanceCatalog(BigInt(chainId))!;

      expect(catalog.size).toBe(TornadoInstances[chainId].length);

      for (const address of ExtendedEthPools[chainId]) {
        expect(catalog.get(address)?.asset).toBe(0n);
      }

      for (const pool of TornadoPaymasterConfigs[chainId].supportedPools) {
        expect(catalog.has(BigInt(pool)), pool).toBe(true);
      }
    }

    const [snapshot] = Object.values(sepoliaSnapshot);
    const sepolia = instanceCatalog(11155111n)!;

    for (const [, pool] of snapshot.pools.poolsTuples) {
      expect(catalogInstanceFor(sepolia, {
        address: BigInt(pool.address),
        asset: BigInt(pool.asset),
        isERC20: pool.isERC20,
        denomination: BigInt(pool.denomination),
      })).toBeDefined();
    }
  });
});

describe('malicious RPC pool injection', () => {
  async function syncWithLyingRpc() {
    const store = storeOn();
    const dataService = {
      // A fake 1 DAI "pool", and a real instance reported with the wrong denomination.
      getAllPoolsAddresses: vi.fn().mockResolvedValue([DAI_100, DAI_1000, FAKE_POOL]),
      getPoolConfig: vi.fn(async (_registry: Address, address: Address) => (
        address === DAI_100 ? daiConfig(DAI_100, 100n * ONE_DAI) : daiConfig(address, ONE_DAI)
      )),
      getUnregisteredNativeEthPoolConfig: vi.fn(),
    };
    const syncService = { getPoolDeploymentBlock: vi.fn().mockResolvedValue(1n) };

    unwrapResult(await store.dispatch(syncPoolsThunk({
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    })));

    return { store, dataService };
  }

  it('registers only registry pools that match the catalog', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, dataService } = await syncWithLyingRpc();
    const pools = poolsSelector(store.getState());

    expect([...pools.keys()]).toEqual([DAI_100]);
    expect(dataService.getPoolConfig).not.toHaveBeenCalledWith(expect.anything(), FAKE_POOL);
    warn.mockRestore();
  });

  it('never deposits into a pool the RPC made up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store } = await syncWithLyingRpc();

    // Defense in depth: even a pool already in state is not a deposit target unless catalogued.
    store.dispatch(registerPools([daiPool(FAKE_POOL, ONE_DAI)]));

    const txns = unwrapResult(await store.dispatch(getDepositPayloadThunk({
      secretManager: secretManager(),
      asset: DAI,
      amount: 150n * ONE_DAI,
      strategy: DepositStrategy.MinFee,
    })));

    expect(txns).toHaveLength(2);
    expect(depositTargets(txns)).toEqual([addressToHex(DAI_100), addressToHex(DAI_100)]);
    warn.mockRestore();
  });

  it('drops persisted pools that are not catalog instances when state loads', async () => {
    const poisoned = storeOn();

    poisoned.dispatch(registerPools([daiPool(DAI_100, 100n * ONE_DAI), daiPool(FAKE_POOL, ONE_DAI)]));

    const storageKey = `tornado-cash-state-1-${TornadoCashConfigs[1].instanceRegistry.address}`;
    const saved = new Map([[storageKey, JSON.stringify(poisoned.getState())]]);
    const storage = {
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: string) => { saved.set(key, value); },
    } as unknown as Storage;

    const stateManager = await storeStateManager({
      secretManagerFactory: async () => secretManager(),
      dataService: { getChainId: async () => 1n } as unknown as IDataService,
      syncService: {} as ISyncService,
      relayerClient: {} as IRelayerClient,
      paymasterConfig: {},
      proverFactory: async () => ({}) as ITornadoProver,
      storageToSyncTo: storage,
      protocolConfig: TornadoCashConfigs[1],
    });

    const txns = await stateManager.getDepositPayload({ asset: DAI, amount: 150n * ONE_DAI, strategy: DepositStrategy.MinFee });

    expect(depositTargets(txns)).toEqual([addressToHex(DAI_100), addressToHex(DAI_100)]);

    const [state] = Object.values(stateManager.dumpState());

    expect(state!.pools.poolsTuples.map(([address]) => BigInt(address))).toEqual([DAI_100]);
  });
});

describe('chains without a catalog', () => {
  const customPool = 0x1234n as Address;
  const custom: ITornadoInstance = { address: customPool, asset: DAI, symbol: 'DAI', decimals: 18, denomination: 100n * ONE_DAI };

  function storeWithPools() {
    const store = storeOn(10n);

    store.dispatch(registerPools([daiPool(customPool, 100n * ONE_DAI), daiPool(FAKE_POOL, ONE_DAI)]));

    return store;
  }

  it('refuses deposits', async () => {
    const result = await storeWithPools().dispatch(getDepositPayloadThunk({
      secretManager: secretManager(),
      asset: DAI,
      amount: 100n * ONE_DAI,
      strategy: DepositStrategy.MinFee,
    }));

    expect(() => unwrapResult(result)).toThrow(/No Tornado instance catalog for chain 10/);
  });

  it('deposits only into an integrator-supplied allowlist', async () => {
    const txns = unwrapResult(await storeWithPools().dispatch(getDepositPayloadThunk({
      secretManager: secretManager(),
      asset: DAI,
      amount: 101n * ONE_DAI,
      strategy: DepositStrategy.MinFee,
      instances: [custom],
    })));

    expect(depositTargets(txns)).toEqual([addressToHex(customPool), addressToHex(customPool)]);
  });
});
