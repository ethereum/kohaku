import { IChainsPaymastersConfig } from "./plugin/interfaces/protocol-params.interface";

// Protocol constants
export const E_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * Per-chain paymaster wiring for sponsored withdrawals. Addresses are
 * placeholders pending the on-chain deployment (contracts are out of scope for
 * this cut); `poolsAccountsMap` routes each pool (lowercase hex) to its adapter.
 */
export const PrivacyPoolsPaymasterConfigs: IChainsPaymastersConfig = {
  11155111: {
    bundlerUrl: "https://public.pimlico.io/v2/11155111/rpc",
    entryPointAddress: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    paymasterAddress: "0x0000000000000000000000000000000000000000",
    poolsAccountsMap: {},
  },
  1: {
    bundlerUrl: "https://public.pimlico.io/v2/1/rpc",
    entryPointAddress: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    paymasterAddress: "0xe06CB96C57D2442f8F60F5017354BC08F7e91308",
    poolsAccountsMap: {
      // ETH pool -> privacypools_simple_eth adapter
      "0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb": "0x0a230D83f16209E2692494a0ae139aAD8C96bde9",
      // USDT pool -> privacypools_complex_usdt_100 adapter
      "0xe859c0bd25f260baee534fb52e307d3b64d24572": "0xFcA5515D05f372Db8E03Bcc6b1a96BF4aC006f33",
      // USDC pool -> privacypools_complex_usdc_100 adapter
      "0xb419c2867ab3cbc78921660cb95150d95a94ce86": "0x16B7d484c634985FbafaaaC6f3ee14e9eFDa4889",
    },
  },
};

export const PrivacyPoolsV1_0xBow = {
  1: {
    entrypoint: {
      entrypointAddress: "0x6818809EefCe719E480a7526D76bD3e561526b46",
      deploymentBlock: 22153713n,
    },
  },
  11155111: {
    entrypoint: {
      entrypointAddress: "0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB",
      deploymentBlock: 8461453n,
    }
  }
};
