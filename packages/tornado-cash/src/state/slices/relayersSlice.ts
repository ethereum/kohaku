import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface IRelayerInfo {
  ensName: string;
  hostname: string;
  relayerAddress: Address;
  stakeBalance: bigint;
}

export interface IRelayerFeeConfig {
  minFee: number;
  maxFee: number;
}

export const DEFAULT_MAINNET_FEE_CONFIG: IRelayerFeeConfig = { minFee: 0.01, maxFee: 0.30 };
export const DEFAULT_OTHER_FEE_CONFIG: IRelayerFeeConfig = { minFee: 0.01, maxFee: 0.30 };

export interface RelayersState {
  relayersTuples: [string, IRelayerInfo][];
  feeConfig: IRelayerFeeConfig;
}

type ActualRelayersState = Serializable<RelayersState>;

const initialState: ActualRelayersState = {
  relayersTuples: [],
  feeConfig: DEFAULT_MAINNET_FEE_CONFIG,
};

export const relayersSlice = createSlice({
  name: 'relayers',
  initialState,
  reducers: {
    registerRelayers: (state, { payload: relayers }: PayloadAction<IRelayerInfo[]>) => {
      const map = new Map<string, Serializable<IRelayerInfo>>(state.relayersTuples);

      relayers.forEach((relayer) => {
        map.set(relayer.ensName, serialize(relayer));
      });

      return { ...state, relayersTuples: Array.from(map) };
    },
    setRelayerFeeConfig: (state, { payload }: PayloadAction<IRelayerFeeConfig>) => {
      return { ...state, feeConfig: payload };
    },
    clearRelayers: () => initialState,
  },
});

export const { registerRelayers, setRelayerFeeConfig, clearRelayers } = relayersSlice.actions;
export const relayersReducer = relayersSlice.reducer;
