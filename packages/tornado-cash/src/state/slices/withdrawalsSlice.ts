import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IWithdrawalEvent } from '../../data/interfaces/events.interface';
import { NullifierHash } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface WithdrawalsState {
  withdrawalsTuples: [NullifierHash, IWithdrawalEvent][];
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
        const key = withdrawal.nullifierHash;

        newWithdrawals.set(serialize(key), serialize(withdrawal));
      });

      return { withdrawalsTuples: Array.from(newWithdrawals) };
    },
  },
});

export const { registerWithdrawals } = withdrawalsSlice.actions;
export const withdrawalsReducer = withdrawalsSlice.reducer;
