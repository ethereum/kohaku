import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IWithdrawalEvent } from '../../data/interfaces/events.interface';
import { Nullifier } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface WithdrawalsState {
  withdrawalsTuples: [Nullifier, IWithdrawalEvent][];
}

type ActualWithdrawalsState = Serializable<WithdrawalsState>;

const initialState: ActualWithdrawalsState = {
  withdrawalsTuples: [],
};

export const withdrawalsSlice = createSlice({
  name: 'withdrawals',
  initialState,
  reducers: {
    registerWithdrawals: ({ withdrawalsTuples }, action: PayloadAction<IWithdrawalEvent[]>) => {
      const newWithdrawals = new Map(withdrawalsTuples);

      action.payload.forEach((withdrawal) => {
        const key = withdrawal.spentNullifier;

        newWithdrawals.set(serialize(key), serialize(withdrawal));
      });

      return { withdrawalsTuples: Array.from(newWithdrawals) };
    },
  },
});

export const { registerWithdrawals } = withdrawalsSlice.actions;
export const withdrawalsReducer = withdrawalsSlice.reducer;
