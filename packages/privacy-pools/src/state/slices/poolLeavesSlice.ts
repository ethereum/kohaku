import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { ILeafInsertedEvent } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { keepUpToBlock } from '../utils/prune.utils';
import { deserialize, serialize } from '../utils/serialize.utils';
import { pruneAfterBlock } from './syncSlice';

export interface PoolLeavesState {
  poolLeavesTuples: [Address, [bigint, ILeafInsertedEvent][]][];
}

type ActualPoolLeavesState = Serializable<PoolLeavesState>;

const initialState: ActualPoolLeavesState = {
  poolLeavesTuples: [],
};

interface RegisterPoolLeavesPayload {
  poolAddress: Address;
  leaves: ILeafInsertedEvent[]
}

export const poolLeavesSlice = createSlice({
  name: 'poolLeaves',
  initialState,
  reducers: {
    registerPoolLeaves: (
      { poolLeavesTuples },
      { payload: {
        poolAddress,
        leaves
      } }: PayloadAction<RegisterPoolLeavesPayload>,
    ) => {
      const allPools = new Map(
        poolLeavesTuples.map(([pool, leavesTuples]) => [deserialize(pool), new Map(deserialize(leavesTuples))] as const),
      );

      const desiredPool = allPools.get(poolAddress) || new Map();

      allPools.set(poolAddress, desiredPool);
      
      leaves.forEach((leaf) => {
        desiredPool.set(leaf.index, leaf);
      })

      return serialize({
        poolLeavesTuples: Array.from(allPools).map(
          ([pool, innerMap]) => [pool, Array.from(innerMap)] as const,
        ),
      });
    },
  },
  extraReducers: (builder) => {
    // Leaves are appended in block order, so this only ever cuts a pool's tail.
    builder.addCase(pruneAfterBlock, ({ poolLeavesTuples }, { payload: block }) => ({
      poolLeavesTuples: poolLeavesTuples.map(([pool, leavesTuples]) => [pool, keepUpToBlock(leavesTuples, block)]),
    }));
  },
});

export const { registerPoolLeaves } = poolLeavesSlice.actions;
export const poolsLeavesReducer = poolLeavesSlice.reducer;
