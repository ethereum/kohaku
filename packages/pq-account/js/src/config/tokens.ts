import type { Address } from "viem";

export type Token = {
  symbol: string;
  name: string;
  decimals: number;
  address: Address | null; // null for native ETH
};

export const TOKENS_BY_CHAIN: Record<number, Token[]> = {
  // Sepolia
  11155111: [
    { symbol: "ETH", name: "Ethereum", decimals: 18, address: null },
    {
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      address: "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      address: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
    },
    {
      symbol: "DAI",
      name: "Dai Stablecoin",
      decimals: 18,
      address: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357",
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
    },
    {
      symbol: "WBTC",
      name: "Wrapped BTC",
      decimals: 8,
      address: "0x29f2D40B0605204364af54EC677bD022dA425d03",
    },
    {
      symbol: "AAVE",
      name: "Aave Token",
      decimals: 18,
      address: "0x88541670E55cC00bEEFD87eB59EDd1b7C511AC9a",
    },
    {
      symbol: "LINK",
      name: "ChainLink Token",
      decimals: 18,
      address: "0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5",
    },
    {
      symbol: "EURS",
      name: "STASIS EURS",
      decimals: 2,
      address: "0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E",
    },
    {
      symbol: "GHO",
      name: "GHO Token",
      decimals: 18,
      address: "0xc4bF5CbDaBE595361438F8c6a187bDc330539c60",
    },
  ],
  // Arbitrum Sepolia
  421614: [
    { symbol: "ETH", name: "Ethereum", decimals: 18, address: null },
    {
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      address: "0x1dF462e2712496373A347f8ad10802a5E95f053D",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    },
  ],
};

export const getTokensForChain = (chainId: number | undefined): Token[] => {
  if (!chainId) return [];

  return TOKENS_BY_CHAIN[chainId] || [];
};
