import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IPool, IPoolWindDownEvent } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';
import { pruneAfterBlock } from './syncSlice';

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
    /** Marks known pools wound down, whichever sync registered them. */
    registerPoolWindDowns: ({ poolsTuples }, { payload: windDowns }: PayloadAction<IPoolWindDownEvent[]>) => {
      const newPools = new Map(poolsTuples);

      windDowns.forEach(({ pool, blockNumber }) => {
        const key = serialize(pool);
        const known = newPools.get(key);

        if (known) {
          newPools.set(key, { ...known, woundDownAtBlock: serialize(blockNumber) });
        }
      });

      return { poolsTuples: Array.from(newPools) };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(pruneAfterBlock, ({ poolsTuples }, { payload: block }) => ({
      poolsTuples: poolsTuples
        .filter(([, { registeredBlock }]) => BigInt(registeredBlock) <= block)
        .map(([address, pool]) => [address, {
          ...pool,
          woundDownAtBlock: pool.woundDownAtBlock !== null && BigInt(pool.woundDownAtBlock) > block
            ? null
            : pool.woundDownAtBlock,
        }]),
    }));
  },
});

export const { registerPools, registerPoolWindDowns } = poolsSlice.actions;
export const poolsReducer = poolsSlice.reducer;
