import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IPoolDepositEvent } from '../../data/interfaces/events.interface';
import { Precommitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { keepUpToBlock } from '../utils/prune.utils';
import { serialize } from '../utils/serialize.utils';
import { pruneAfterBlock } from './syncSlice';

export interface DepositsState {
  depositsTuples: [Precommitment, IPoolDepositEvent][];
}

type ActualDepositsState = Serializable<DepositsState>;

const initialState: ActualDepositsState = {
  depositsTuples: [],
};

export const depositsSlice = createSlice({
  name: 'deposits',
  initialState,
  reducers: {
    registerDeposits: ({ depositsTuples }, { payload: deposits }: PayloadAction<IPoolDepositEvent[]>) => {
      const newDeposits = new Map(depositsTuples);

      deposits.forEach((deposit) => {
        const key = deposit.precommitment;

        newDeposits.set(serialize(key), serialize(deposit));
      });

      return { depositsTuples: Array.from(newDeposits) };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(pruneAfterBlock, ({ depositsTuples }, { payload: block }) => ({
      depositsTuples: keepUpToBlock(depositsTuples, block),
    }));
  },
});

export const { registerDeposits } = depositsSlice.actions;
export const depositsReducer = depositsSlice.reducer;
