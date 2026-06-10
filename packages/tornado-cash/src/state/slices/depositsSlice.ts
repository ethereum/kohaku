import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDepositEvent } from '../../data/interfaces/events.interface';
import { Address, Commitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

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
});

export const { registerDeposits } = depositsSlice.actions;
export const depositsReducer = depositsSlice.reducer;
