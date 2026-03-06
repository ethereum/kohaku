import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { ILeafInsertedEvent } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { deserialize, serialize } from '../utils/serialize.utils';

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
});

export const { registerPoolLeaves } = poolLeavesSlice.actions;
export const poolsLeavesReducer = poolLeavesSlice.reducer;
