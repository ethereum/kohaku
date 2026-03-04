import { createAsyncThunk } from '@reduxjs/toolkit';
import { IPool, IPoolRegisteredEvent, IPoolWindDownEvent } from '../../data/interfaces/events.interface';
import { registerPools } from '../slices/poolsSlice';
import { RootState } from '../store';

export interface SyncPoolsThunkParams {
  poolsRegistered: IPoolRegisteredEvent[];
  poolsWoundDown: IPoolWindDownEvent[];
}

export const syncPoolsThunk = createAsyncThunk<void, SyncPoolsThunkParams, { state: RootState }>(
  'sync/pools',
  async ({
    poolsRegistered,
    poolsWoundDown
  }, { dispatch }) => {
    const deadPools = new Map(poolsWoundDown.map((pool) => [pool.pool, pool]));
  
    const pools = poolsRegistered.map(({
      pool: address,
      blockNumber,
      asset,
      scope,
    }): IPool => {
      const woundDownAtBlock = deadPools.get(address)?.blockNumber ?? null;
      
      return {
        address,
        asset,
        registeredBlock: blockNumber,
        woundDownAtBlock,
        scope,
      }
    });

    dispatch(registerPools(pools));
  }
);
