import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDepositEvent } from '../../data/interfaces/events.interface';
import { Commitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface DepositsState {
  depositsTuples: [Commitment, IDepositEvent][];
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
      const newDeposits = new Map(depositsTuples);

      deposits.forEach((deposit) => {
        const key = deposit.commitment;

        newDeposits.set(serialize(key), serialize(deposit));
      });

      return { depositsTuples: Array.from(newDeposits) };
    },
  },
});

export const { registerDeposits } = depositsSlice.actions;
export const depositsReducer = depositsSlice.reducer;
