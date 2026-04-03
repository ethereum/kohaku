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
    const { instanceRegistryAddress, deploymentBlock, lastDeployedOnBlock } = instanceRegistryInfoSelector(state);
    const existingPools = poolsSelector(state);
    // const deadPools = new Map(poolsWoundDown.map((pool) => [pool.pool, pool]));
  
    // const pools = poolsRegistered.map(({
    //   pool: address,
    //   blockNumber,
    //   asset,
    //   scope,
    // }): IPool => {
    //   const woundDownAtBlock = deadPools.get(address)?.blockNumber ?? null;
      
    //   return {
    //     address,
    //     asset,
    //     registeredBlock: blockNumber,
    //     woundDownAtBlock,
    //     scope,
    //   }
    // });

    const poolsAddressses = await dataService.getAllPoolsAddresses(instanceRegistryAddress);
    const unsyncedPools = poolsAddressses.filter((address) => !existingPools.has(address));
    const unsyncedPoolsInformation = await Promise.allSettled(unsyncedPools.map(
      (poolAddress) => dataService.getPoolConfig(instanceRegistryAddress, poolAddress)
    ));

    const poolRegisteredEvents = await dataService.getInstanceRegistryEvents({
      events: 'InstanceStateUpdated',
      address: instanceRegistryAddress,
      fromBlock: deploymentBlock,
      toBlock: lastDeployedOnBlock
    });

    const poolsRegisteredAtBlockMap = new Map(
      poolRegisteredEvents.InstanceStateUpdated
        .map(({ address, blockNumber }) => [address, blockNumber] as const)
    );

    const fetchedPools = unsyncedPoolsInformation.filter((p) => p.status === 'fulfilled');

    if (fetchedPools.length < unsyncedPools.length) {
      const failedFetches = unsyncedPoolsInformation.filter((p) => p.status === 'rejected');

      console.warn('Failed to fetch some pools information', failedFetches.map((p) => p.reason))
    }

    const pools: IPool[] = fetchedPools
    .map(({
      value: {
        poolAddress,
        protocolFeePercentage,
        token,
        uniswapPoolSwappingFee,
        state,
        isERC20,
        denomination
      }
    }) => ({
      address: poolAddress,
      asset: token,
      isERC20,
      denomination,
      registeredBlock: poolsRegisteredAtBlockMap.get(poolAddress)!,
      uniswapPoolSwappingFee,
      protocolFeePercentage,
      state
    }))

    dispatch(registerPools(pools));
  }
);
