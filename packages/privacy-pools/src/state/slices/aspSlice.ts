import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Label } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface AspState {
  leaves: Label[];
  aspTreeRoot: bigint;
  blockNumber: bigint;
}

type ActualAspState = Serializable<AspState>;

const initialState: ActualAspState = {
  leaves: [],
  aspTreeRoot: '0',
  blockNumber: '0',
};

export const aspSlice = createSlice({
  name: 'asp',
  initialState,
  reducers: {
    registerAspTree: (state, { payload }: PayloadAction<AspState>) => {
      return serialize(payload);
    },
  },
});

export const aspReducer = aspSlice.reducer;

export const { registerAspTree } = aspSlice.actions;
