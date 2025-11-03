import { Address } from 'viem';

export type ChainId = `${bigint}`;
export const ACCOUNT_VERSION = 1;
export const ACCOUNT_CHAIN_ID = undefined;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_ARRAY = new Uint8Array(new Array(32).fill(0));
export const E_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const TOTAL_LEAVES = 2 ** 16;

export type RailgunNetworkConfig = {
  NAME: string;
  RAILGUN_ADDRESS: string;
  GLOBAL_START_BLOCK: number;
  CHAIN_ID: bigint;
  RELAY_ADAPT_ADDRESS: string;
  WETH: Address;
  FEE_BASIS_POINTS: bigint;
};

export type RailgunConfigMap = Record<ChainId, RailgunNetworkConfig>;
