import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IContract, IScrapeableContract } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

interface InstanceRegistryConfig extends IScrapeableContract {
  lastDeployedOnBlock?: bigint;
}

export interface ProtocolConfigState {
  chainId: bigint;
  ensSubdomainKey: string;
  instanceRegistry: InstanceRegistryConfig;
  relayerRegistry: IScrapeableContract;
  aggregator: IContract;
}

type ActualProtocolConfigState = Serializable<ProtocolConfigState>;

const initialState: ActualProtocolConfigState = {
  chainId: '0',
  instanceRegistry: {
    address: '0',
    deploymentBlock: '0'
  },
  relayerRegistry: {
    address: '0',
    deploymentBlock: '0'
  },
  aggregator: {
    address: '0'
  },
  ensSubdomainKey: '',
};

export const protocolConfigSlice = createSlice({
  name: 'protocolConfig',
  initialState,
  reducers: {
    setProtocolConfig: (state, {payload}: PayloadAction<ProtocolConfigState>) => {
      return serialize(payload);
    },
  },
});

export const { setProtocolConfig } = protocolConfigSlice.actions;
export const protocolConfigReducer = protocolConfigSlice.reducer;
