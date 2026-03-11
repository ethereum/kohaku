import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IPoolDepositEvent } from '../../data/interfaces/events.interface';
import { Precommitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

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
});

export const { registerDeposits } = depositsSlice.actions;
export const depositsReducer = depositsSlice.reducer;
