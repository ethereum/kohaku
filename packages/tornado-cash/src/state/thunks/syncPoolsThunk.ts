import { createAsyncThunk } from '@reduxjs/toolkit';
import { extendedEthPoolSet } from '../../config';
import { catalogInstanceFor, instanceCatalog, ITornadoInstance } from '../../instances';
import { addressToHex } from '../../utils';
import { IPool } from '../../data/interfaces/events.interface';
import { registerPools } from '../slices/poolsSlice';
import { RootState } from '../store';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { ISyncService } from '../../data/interfaces/sync.service.interface';
import { instanceRegistryInfoSelector, poolsSelector } from '../selectors/slices.selectors';
import { IPoolSyncFailure, poolSyncFailure } from '../pool-sync-error';
import { allSettledLimited, POOL_CONCURRENCY } from '../../utils/settle-limited';

/**
 * The most instances a registry may list on a chain without a catalog. The
 * mainnet registry holds about 20; a longer list is refused rather than cut
 * short, so no pool is silently left out. With a catalog only its pools are fetched.
 */
export const MAX_REGISTRY_POOLS = 64;

export interface SyncPoolsThunkParams {
  dataService: IDataService;
  syncService: ISyncService;
  /** Overrides the built-in instance catalog for this chain. */
  instances?: readonly ITornadoInstance[];
}

/** Resolves with the pools whose metadata could not be fetched; they are left unregistered. */
export const syncPoolsThunk = createAsyncThunk<IPoolSyncFailure[], SyncPoolsThunkParams, { state: RootState }>(
  'sync/pools',
  async ({
    dataService,
    syncService,
    instances,
  }, { dispatch, getState }) => {
    const state = getState();
    const {
      chainId,
      useExtendedEthPools,
      instanceRegistry: { address: instanceRegistryAddress },
    } = instanceRegistryInfoSelector(state);
    const existingPools = poolsSelector(state);
    // The registry and pool contracts are read through the RPC, so on chains
    // with a catalog only its instances are fetched, and only if they match it.
    const catalog = instanceCatalog(chainId, instances);

    const registryAddresses = await dataService.getAllPoolsAddresses(instanceRegistryAddress);

    if (!catalog && registryAddresses.length > MAX_REGISTRY_POOLS) {
      throw new Error(`Instance registry lists ${registryAddresses.length} pools, more than the ${MAX_REGISTRY_POOLS} allowed`);
    }

    const registrySet = new Set(registryAddresses);
    const extendedPools = extendedEthPoolSet(chainId);
    const poolAddresses = new Set(
      useExtendedEthPools
        ? registryAddresses
        : registryAddresses.filter((address) => !extendedPools.has(address)),
    );

    if (useExtendedEthPools) {
      for (const address of extendedPools) poolAddresses.add(address);
    }

    const savedExtendedPools = [...existingPools.values()].filter(
      (pool) => extendedPools.has(pool.address) && !pool.extended,
    );

    if (savedExtendedPools.length > 0) {
      dispatch(registerPools(savedExtendedPools.map((pool) => ({ ...pool, extended: true }))));
    }

    const uncataloguedPools = catalog ? [...poolAddresses].filter((address) => !catalog.has(address)) : [];

    if (uncataloguedPools.length > 0) {
      // A custom catalog may deliberately select only one pool for a deposit.
      // Report unexpected gaps only when using the default chain catalog.
      if (instances === undefined) {
        console.warn('Ignoring pools missing from the instance catalog', uncataloguedPools.map((address) => addressToHex(address)));
      }

      uncataloguedPools.forEach((address) => poolAddresses.delete(address));
    }

    const unsyncedPools = [...poolAddresses].filter((address) => !existingPools.has(address));

    const unsyncedPoolsData = await allSettledLimited(
      unsyncedPools,
      POOL_CONCURRENCY,
      async (poolAddress) => {
        const [config, registeredBlock] = await Promise.all([
          registrySet.has(poolAddress)
            ? dataService.getPoolConfig(instanceRegistryAddress, poolAddress)
            : dataService.getUnregisteredNativeEthPoolConfig(poolAddress),
          syncService.getPoolDeploymentBlock({ chainId, address: poolAddress }),
        ]);

        return { config, registeredBlock };
      },
    );
    const fetchedPools = unsyncedPoolsData.filter((p) => p.status === 'fulfilled');
    const failures = unsyncedPoolsData.flatMap((p, index) => (
      p.status === 'rejected' ? [poolSyncFailure(unsyncedPools[index]!, p.reason)] : []
    ));

    const pools: IPool[] = fetchedPools
    .map(({
      value: {
        registeredBlock,
        config: {
          poolAddress,
          protocolFeePercentage,
          token,
          state,
          isERC20,
          denomination,
          rootHistorySize
        }
      }
    }) => ({
      address: poolAddress,
      asset: token,
      isERC20,
      denomination,
      registeredBlock,
      protocolFeePercentage,
      state,
      rootHistorySize,
      ...(extendedPools.has(poolAddress) ? { extended: true } : {}),
    }))
    .filter((pool) => {
      if (!catalog || catalogInstanceFor(catalog, pool)) return true;

      console.warn(`Ignoring pool ${addressToHex(pool.address)}: asset or denomination differs from the instance catalog`);

      return false;
    });

    dispatch(registerPools(pools));

    return failures;
  }
);
