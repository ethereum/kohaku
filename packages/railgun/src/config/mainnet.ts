import type { RailgunNetworkConfig } from './constants';

export const mainnetConfig: RailgunNetworkConfig = {
  NAME: 'mainnet',
  RAILGUN_ADDRESS: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',
  GLOBAL_START_BLOCK: 14693013,
  CHAIN_ID: BigInt(1),
  RELAY_ADAPT_ADDRESS: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  FEE_BASIS_POINTS: 25n,
};
