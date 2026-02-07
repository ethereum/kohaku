import type { Address } from "viem";

export const WETH_GATEWAY_ABI = [
  {
    inputs: [
      { name: "pool", type: "address" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    name: "depositETH",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    name: "withdrawETH",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const AAVE_POOL_ABI = [
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    name: "supply",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    name: "borrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    name: "repay",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    name: "withdraw",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserAccountData",
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const AAVE_FAUCET_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type AaveTokenInfo = {
  address: Address;
  decimals: number;
  aToken: Address;
  debtToken: Address;
};

export type AaveNetworkConfig = {
  name: string;
  pool: Address;
  wethGateway: Address;
  faucet: Address;
  poolDataProvider: Address;
  tokens: Record<string, AaveTokenInfo>;
};

export type AavePosition = {
  totalCollateralUSD: number;
  totalDebtUSD: number;
  availableBorrowsUSD: number;
  liquidationThreshold: number;
  ltv: number;
  healthFactor: number | "Infinity";
  supplies: Array<{ symbol: string; amount: number }>;
  borrows: Array<{ symbol: string; amount: number }>;
};

// Aave V3 Addresses by Chain
export const AAVE_CONFIG: Record<number, AaveNetworkConfig> = {
  // Ethereum Sepolia
  11155111: {
    name: "Ethereum Sepolia",
    pool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
    wethGateway: "0x387d311e47e80b498169e6fb51d3193167d89F7D",
    faucet: "0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D",
    poolDataProvider: "0x3e9708d80f7B3e43118013075F7e95CE3AB31F31",
    tokens: {
      WETH: {
        address: "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c",
        decimals: 18,
        aToken: "0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830",
        debtToken: "0x22a35DB253f4F6D0029025D6312A3BdAb20C2c6A",
      },
      USDC: {
        address: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
        decimals: 6,
        aToken: "0x16dA4541aD1807f4443d92D26044C1147406EB80",
        debtToken: "0x36B5dE936eF1710E1d22EabE5231b28581a92ECc",
      },
      DAI: {
        address: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357",
        decimals: 18,
        aToken: "0x29598b72eb5CeBd806C5dCD549490FdA35B13cD8",
        debtToken: "0x22675C506A8FC26447aFFfa33640f6af5d4D4cF0",
      },
      USDT: {
        address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
        decimals: 6,
        aToken: "0xAF0F6e8b0Dc5c913bbF4d14c22B4E78Dd14310B6",
        debtToken: "0x9844386d29EEd970B9F6a2B9a676083b0478210e",
      },
      WBTC: {
        address: "0x29f2D40B0605204364af54EC677bD022dA425d03",
        decimals: 8,
        aToken: "0x1804Bf30507dc2EB3bDEbbbdd859991EAeF6EefF",
        debtToken: "0xEB016dFd303F19fbDdFb6300eB4AeB2DA7Ceac37",
      },
    },
  },
};

export const VARIABLE_RATE_MODE = 2n;

export const REFERRAL_CODE = 0;
