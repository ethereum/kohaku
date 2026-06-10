import { TornadoCashConfigs } from "../src";
import { TornadoPaymasterConfigs } from "../src/config";
import { getEnv } from "./utils/common";

export const getChainConfigSetup = (chainId: 1 | 11155111) => {
  if (chainId === 1) {
    return {
      protocolConfig: TornadoCashConfigs[1],
      rpcUrl: getEnv('RPC_URL_MAINNET'),
      forkBlockNumber: getEnv('TORNADO_MAINNET_FORK_BLOCK', '14273357'),
      erc20Address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',  // USDC
      erc20WhaleAddress: '0x55FE002aefF02f77364de339a1292923A15844B8',
      paymasterConfig: TornadoPaymasterConfigs[chainId],
    }
  }

  return {
    protocolConfig: TornadoCashConfigs[11155111],
    rpcUrl: getEnv('RPC_URL_SEPOLIA'),
    forkBlockNumber: getEnv('TORNADO_SEPOLIA_FORK_BLOCK', '10899138'),
    erc20Address: '0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357',  // DAI
    erc20WhaleAddress: '0xc0dEC722b431c02a0787F349587B783A0f2F3281',
    paymasterConfig: TornadoPaymasterConfigs[chainId],
  }
};
