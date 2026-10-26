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
  /** Service fee window, in the unit of the relayer's `tornadoServiceFee` (percent). */
  minFee: number;
  maxFee: number;
  /**
   * Cap on each note's total relayer fee (network + service), in basis points of
   * its denomination. Defaults to {@link DEFAULT_MAX_TOTAL_FEE_BPS}.
   */
  maxTotalFeeBps?: number;
  /**
   * ERC-20 pools: how far, in basis points, a relayer's token price may push the
   * network fee above the paymaster's on-chain TWAP quote. Defaults to
   * {@link DEFAULT_MAX_PRICE_DEVIATION_BPS}.
   */
  maxPriceDeviationBps?: number;
}

/** 20%: a 100 DAI/USDC/USDT note at up to ~15 gwei with ETH at $2,300, 0.1 ETH at up to ~36 gwei. */
export const DEFAULT_MAX_TOTAL_FEE_BPS = 2_000;
/** 20%: covers TWAP lag behind a relayer's spot price in fast markets. */
export const DEFAULT_MAX_PRICE_DEVIATION_BPS = 2_000;

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
