import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDepositEvent } from '../../data/interfaces/events.interface';
import { Address, Commitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { keepBeforeBlock } from '../utils/prune.utils';
import { serialize } from '../utils/serialize.utils';
import { prunePoolFromBlock } from './syncSlice';

export interface DepositsState {
  depositsTuples: [Address, [Commitment, IDepositEvent][]][];
}

type ActualDepositsState = Serializable<DepositsState>;

const initialState: ActualDepositsState = {
  depositsTuples: [],
};

export const depositsSlice = createSlice({
  name: 'deposits',
  initialState,
  reducers: {
    registerDeposits: ({ depositsTuples }, { payload: deposits }: PayloadAction<IDepositEvent[]>) => {
      const allPools = new Map(
        depositsTuples.map(([pool, innerTuples]) =>
          [pool, new Map(innerTuples)] as const
        )
      );


      deposits.forEach((deposit) => {
        const poolKey = serialize(deposit.pool);
        const poolDeposits: Map<string, Serializable<IDepositEvent>> = allPools.get(poolKey) || new Map();
    
        allPools.set(poolKey, poolDeposits);
        poolDeposits.set(serialize(deposit.commitment), serialize(deposit));
      });

      return {
        depositsTuples: Array.from(allPools).map(
          ([pool, innerMap]) => [pool, Array.from(innerMap)] as const,
        ),
      };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(prunePoolFromBlock, ({ depositsTuples }, { payload: { pool, block } }) => ({
      depositsTuples: depositsTuples.map(([key, tuples]) =>
        [key, BigInt(key) === pool ? keepBeforeBlock(tuples, block) : tuples] as const),
    }));
  },
});

export const { registerDeposits } = depositsSlice.actions;
export const depositsReducer = depositsSlice.reducer;
