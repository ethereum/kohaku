import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IPool } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface PoolsState {
  poolsTuples: [Address, IPool][];
}

type ActualPoolsState = Serializable<PoolsState>;

const initialState: ActualPoolsState = {
  poolsTuples: [],
};

export const poolsSlice = createSlice({
  name: 'pools',
  initialState,
  reducers: {
    registerPools: ({ poolsTuples }, { payload: pools }: PayloadAction<IPool[]>) => {
      const newPools = new Map(poolsTuples);

      pools.forEach((pool) => {
        const key = pool.address;

        newPools.set(serialize(key), serialize(pool));
      });

      return { poolsTuples: Array.from(newPools) };
    },
    setPoolSyncedBlock: (
      { poolsTuples },
      { payload: { pool, block } }: PayloadAction<{ pool: Address; block: bigint }>,
    ) => {
      const newPools = new Map(poolsTuples);
      const key = serialize(pool);
      const existing = newPools.get(key);

      if (existing) {
        newPools.set(key, { ...existing, lastSyncedBlock: serialize(block) });
      }

      return { poolsTuples: Array.from(newPools) };
    },
  },
});

export const { registerPools, setPoolSyncedBlock } = poolsSlice.actions;
export const poolsReducer = poolsSlice.reducer;
