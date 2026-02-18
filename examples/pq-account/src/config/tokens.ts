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
  ],
};
