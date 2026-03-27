import { PrivacyPoolsV1_0xBow } from "../src";
import { getEnv } from "./utils/common";

export const chainConfigSetup = {
  1: {
    rpcUrl: getEnv('RPC_URL_MAINNET'),
    forkBlockNumber: getEnv('PPV1_MAINNET_FORK_BLOCK', '24628323'),
    erc20Address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',  // USDC
    erc20WhaleAddress: '0x55FE002aefF02f77364de339a1292923A15844B8',
    entrypoint: {
      address: BigInt(PrivacyPoolsV1_0xBow[1].entrypoint.entrypointAddress),
      deploymentBlock: PrivacyPoolsV1_0xBow[1].entrypoint.deploymentBlock,
    },
    postman: "0x1f4Fe25Cf802a0605229e0Dc497aAf653E86E187"
  },
  11155111: {
    rpcUrl: getEnv('RPC_URL_SEPOLIA'),
    forkBlockNumber: getEnv('PPV1_SEPOLIA_FORK_BLOCK', '8742157'),
    erc20Address: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',  // USDT
    erc20WhaleAddress: '0xc94b1BEe63A3e101FE5F71C80F912b4F4b055925',
    entrypoint: {
      address: BigInt(PrivacyPoolsV1_0xBow[11155111].entrypoint.entrypointAddress),
      deploymentBlock: PrivacyPoolsV1_0xBow[11155111].entrypoint.deploymentBlock,
    },
    postman: "0x696FE46495688fC9e99BAd2dAF2133B33de364eA"
  }
} as const;
