import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface InstanceRegistryInfoState {
  chainId: bigint;
  instanceRegistryAddress: Address;
  deploymentBlock: bigint;
  lastDeployedOnBlock?: bigint;
}

type ActualInstanceRegistryInfoState = Serializable<InstanceRegistryInfoState>;

const initialState: ActualInstanceRegistryInfoState = {
  chainId: '0',
  instanceRegistryAddress: '0',
  deploymentBlock: '0',
};

export const instanceRegistryInfoSlice = createSlice({
  name: 'instanceRegistryInfo',
  initialState,
  reducers: {
    setInstanceregistryInfo: (state, {payload}: PayloadAction<InstanceRegistryInfoState>) => {
      return serialize(payload);
    },
  },
});

export const { setInstanceregistryInfo } = instanceRegistryInfoSlice.actions;
export const instanceRegistryInfoReducer = instanceRegistryInfoSlice.reducer;
