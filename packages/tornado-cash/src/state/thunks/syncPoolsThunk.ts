import { createAsyncThunk } from '@reduxjs/toolkit';
import { extendedEthPoolSet } from '../../config';
import { IPool } from '../../data/interfaces/events.interface';
import { registerPools } from '../slices/poolsSlice';
import { RootState } from '../store';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { ISyncService } from '../../data/interfaces/sync.service.interface';
import { instanceRegistryInfoSelector, poolsSelector } from '../selectors/slices.selectors';

export interface SyncPoolsThunkParams {
  dataService: IDataService;
  syncService: ISyncService;
}

export const syncPoolsThunk = createAsyncThunk<void, SyncPoolsThunkParams, { state: RootState }>(
  'sync/pools',
  async ({
    dataService,
    syncService,
  }, { dispatch, getState }) => {
    const state = getState();
    const {
      chainId,
      ignoreExtendedEthPools,
      instanceRegistry: { address: instanceRegistryAddress },
    } = instanceRegistryInfoSelector(state);
    const existingPools = poolsSelector(state);

    const registryAddresses = await dataService.getAllPoolsAddresses(instanceRegistryAddress);
    const registrySet = new Set(registryAddresses);
    const extendedPools = extendedEthPoolSet(chainId);
    const poolAddresses = new Set(
      ignoreExtendedEthPools
        ? registryAddresses.filter((address) => !extendedPools.has(address))
        : registryAddresses,
    );

    if (!ignoreExtendedEthPools) {
      for (const address of extendedPools) poolAddresses.add(address);
    }

    const unsyncedPools = [...poolAddresses].filter((address) => !existingPools.has(address));

    const unsyncedPoolsData = await Promise.allSettled(
      unsyncedPools.map(async (poolAddress) => {
        const [config, registeredBlock] = await Promise.all([
          registrySet.has(poolAddress)
            ? dataService.getPoolConfig(instanceRegistryAddress, poolAddress)
            : dataService.getUnregisteredNativeEthPoolConfig(poolAddress),
          syncService.getPoolDeploymentBlock({ chainId, address: poolAddress }),
        ]);

        return { config, registeredBlock };
      })
    );
    const fetchedPools = unsyncedPoolsData.filter((p) => p.status === 'fulfilled');

    if (fetchedPools.length < unsyncedPools.length) {
      const failedFetches = unsyncedPoolsData.filter((p) => p.status === 'rejected');

      console.warn('Failed to fetch some pools information', failedFetches.map((p) => p.reason))
    }

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
      rootHistorySize
    }))

    dispatch(registerPools(pools));
  }
);
