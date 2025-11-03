import type { RailgunNetworkConfig } from "./constants";

export const sepoliaConfig: RailgunNetworkConfig = {
  NAME: "sepolia",
  RAILGUN_ADDRESS: "0x942D5026b421cf2705363A525897576cFAdA5964",
  GLOBAL_START_BLOCK: 4495479,
  CHAIN_ID: BigInt(11155111),
  RELAY_ADAPT_ADDRESS: "0x66af65bfff9e384796a56f3fa3709b9d5d9d7083",
  WETH: "0x97a36608DA67AF0A79e50cb6343f86F340B3b49e",
  FEE_BASIS_POINTS: 25n,
};
