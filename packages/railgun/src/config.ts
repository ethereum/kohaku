/**
 * Network configuration for Railgun contracts across different chains
 */

import { ChainId } from "./account-utils/types";

export const ACCOUNT_VERSION = 1;
export const ACCOUNT_CHAIN_ID = undefined;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_ARRAY = new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
export const E_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const TOTAL_LEAVES = 2**16;

export type RailgunNetworkConfig = {
  NAME: string;
  RAILGUN_ADDRESS: string;
  GLOBAL_START_BLOCK: number;
  CHAIN_ID: bigint;
  RELAY_ADAPT_ADDRESS: string;
  WETH: string;
  FEE_BASIS_POINTS: bigint;
}

export const RAILGUN_CONFIG_BY_CHAIN_ID: Record<ChainId, RailgunNetworkConfig> = {
  ["1"]: {
    NAME: 'mainnet',
    RAILGUN_ADDRESS: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',
    GLOBAL_START_BLOCK: 14693013,
    CHAIN_ID: BigInt(1),
    RELAY_ADAPT_ADDRESS: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    FEE_BASIS_POINTS: 25n,
  },
  ["11155111"]: {
    NAME: 'sepolia',
    RAILGUN_ADDRESS: '0x942D5026b421cf2705363A525897576cFAdA5964',
    GLOBAL_START_BLOCK: 4495479,
    CHAIN_ID: BigInt(11155111),
    RELAY_ADAPT_ADDRESS: '0x66af65bfff9e384796a56f3fa3709b9d5d9d7083',
    WETH: '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e',
    FEE_BASIS_POINTS: 25n,
  }
};
