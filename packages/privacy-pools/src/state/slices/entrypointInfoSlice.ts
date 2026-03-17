import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface EntrypointInfoState {
  chainId: bigint;
  entrypointAddress: Address;
  deploymentBlock: bigint;
}

type ActualEntrypointInfoState = Serializable<EntrypointInfoState>;

const initialState: ActualEntrypointInfoState = {
  chainId: '0',
  entrypointAddress: '0',
  deploymentBlock: '0',
};

export const entrypointInfoSlice = createSlice({
  name: 'poolInfo',
  initialState,
  reducers: {
    setEntrypointInfo: (state, {payload}: PayloadAction<EntrypointInfoState>) => {
      return serialize(payload);
    },
  },
});

export const { setEntrypointInfo } = entrypointInfoSlice.actions;
export const entrypointInfoReducer = entrypointInfoSlice.reducer;
