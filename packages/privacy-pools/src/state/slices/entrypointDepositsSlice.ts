import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IEntrypointDepositEvent } from '../../data/interfaces/events.interface';
import { Commitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { keepUpToBlock } from '../utils/prune.utils';
import { serialize } from '../utils/serialize.utils';
import { pruneAfterBlock } from './syncSlice';

export interface EntrypointDepositsState {
  entrypointDepositsTuples: [Commitment, IEntrypointDepositEvent][];
}

type ActualEntrypointDepositsState = Serializable<EntrypointDepositsState>;

const initialState: ActualEntrypointDepositsState = {
  entrypointDepositsTuples: [],
};

export const entrypointDepositsSlice = createSlice({
  name: 'entrypointDeposits',
  initialState,
  reducers: {
    registerEntrypointDeposits: ({ entrypointDepositsTuples }, { payload: entrypointDeposits }: PayloadAction<IEntrypointDepositEvent[]>) => {
      const newDeposits = new Map(entrypointDepositsTuples);

      entrypointDeposits.forEach((deposit) => {
        const key = deposit.commitment;

        newDeposits.set(serialize(key), serialize(deposit));
      });

      return { entrypointDepositsTuples: Array.from(newDeposits) };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(pruneAfterBlock, ({ entrypointDepositsTuples }, { payload: block }) => ({
      entrypointDepositsTuples: keepUpToBlock(entrypointDepositsTuples, block),
    }));
  },
});

export const { registerEntrypointDeposits } = entrypointDepositsSlice.actions;
export const entrypointDepositsReducer = entrypointDepositsSlice.reducer;
