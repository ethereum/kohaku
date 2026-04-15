import { createAsyncThunk } from '@reduxjs/toolkit';
import { IPool } from '../../data/interfaces/events.interface';
import { registerPools } from '../slices/poolsSlice';
import { RootState } from '../store';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { instanceRegistryInfoSelector, poolsSelector } from '../selectors/slices.selectors';

export interface SyncPoolsThunkParams {
  dataService: IDataService;
}

export const syncPoolsThunk = createAsyncThunk<void, SyncPoolsThunkParams, { state: RootState }>(
  'sync/pools',
  async ({
    dataService
  }, { dispatch, getState }) => {
    const state = getState();
    const { instanceRegistryAddress } = instanceRegistryInfoSelector(state);
    const existingPools = poolsSelector(state);

    const poolsAddressses = await dataService.getAllPoolsAddresses(instanceRegistryAddress);
    const unsyncedPools = poolsAddressses.filter((address) => !existingPools.has(address));

    const unsyncedPoolsData = await Promise.allSettled(
      unsyncedPools.map(async (poolAddress) => {
        const [config, registeredBlock] = await Promise.all([
          dataService.getPoolConfig(instanceRegistryAddress, poolAddress),
          dataService.getContractDeploymentBlock(poolAddress),
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
          uniswapPoolSwappingFee,
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
      uniswapPoolSwappingFee,
      protocolFeePercentage,
      state,
      rootHistorySize
    }))

    dispatch(registerPools(pools));
  }
);
