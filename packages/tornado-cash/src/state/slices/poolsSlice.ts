import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IPool } from '../../data/interfaces/events.interface';
import { IMerkleFrontier } from '../../utils/merkle-frontier';
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
    removePools: ({ poolsTuples }, { payload: addresses }: PayloadAction<Address[]>) => {
      const removed = new Set<bigint>(addresses);

      return { poolsTuples: poolsTuples.filter(([key]) => !removed.has(BigInt(key))) };
    },
    setPoolSyncedBlocks: (
      { poolsTuples },
      { payload: { pool, head, finalized, verifiedRoot, frontier } }: PayloadAction<{
        pool: Address;
        head: bigint;
        finalized: bigint;
        verifiedRoot: bigint;
        frontier: IMerkleFrontier;
      }>,
    ) => {
      const newPools = new Map(poolsTuples);
      const key = serialize(pool);
      const existing = newPools.get(key);

      if (existing) {
        newPools.set(key, {
          ...existing,
          lastSyncedBlock: serialize(head),
          finalizedBlock: serialize(finalized),
          verifiedRoot: serialize(verifiedRoot),
          frontier: serialize(frontier),
        });
      }

      return { poolsTuples: Array.from(newPools) };
    },
  },
});

export const { registerPools, removePools, setPoolSyncedBlocks } = poolsSlice.actions;
export const poolsReducer = poolsSlice.reducer;
