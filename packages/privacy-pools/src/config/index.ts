export type PPv1NetworkConfig = {
  NAME: string;
  CHAIN_ID: number;
  ENTRYPOINT_ADDRESS: string;
};

// Sepolia testnet config with mocks
export const SEPOLIA_CONFIG: PPv1NetworkConfig = {
  NAME: "sepolia",
  CHAIN_ID: 11155111,
  ENTRYPOINT_ADDRESS: "",
};

// Mainnet config with mocks
export const MAINNET_CONFIG: PPv1NetworkConfig = {
  NAME: "mainnet",
  CHAIN_ID: 1,
  ENTRYPOINT_ADDRESS: "0x6818809EefCe719E480a7526D76bD3e561526b46",
};

// Re-export constants
export { MOCK_POOL_ADDRESS, MOCK_VERIFIER_ADDRESS, COMMITMENT_TREE_DEPTH, POOL_VERSION, E_ADDRESS } from './constants';
