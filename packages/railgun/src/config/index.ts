import {
  ACCOUNT_CHAIN_ID,
  ACCOUNT_VERSION,
  ChainId,
  E_ADDRESS,
  TOTAL_LEAVES,
  ZERO_ADDRESS,
  ZERO_ARRAY,
  type RailgunConfigMap,
  type RailgunNetworkConfig,
} from './constants';
import { mainnetConfig } from './mainnet';
import { sepoliaConfig } from './sepolia';

export type { RailgunNetworkConfig } from './constants';
export {
  ACCOUNT_CHAIN_ID,
  ACCOUNT_VERSION,
  E_ADDRESS,
  TOTAL_LEAVES,
  ZERO_ADDRESS,
  ZERO_ARRAY,
};

export const RAILGUN_CONFIG_BY_CHAIN_ID: RailgunConfigMap = {
  '1': mainnetConfig,
  '11155111': sepoliaConfig,
} as const;

export const getNetworkConfig = (chainId: ChainId): RailgunNetworkConfig => {
  const config = RAILGUN_CONFIG_BY_CHAIN_ID[chainId as keyof RailgunConfigMap];

  if (!config) {
    throw new Error(`Chain ID ${chainId} not supported`);
  }

  return config;
};
