// Protocol constants
export const E_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const E_ADDRESS_BIGINT = BigInt(E_ADDRESS);

export const TornadoCashConfigs = {
  1: {
    ensSubdomainKey: 'mainnet-tornado',
    instanceRegistry: {
      address: 0xB20c66C4DE72433F3cE747b58B86830c459CA911n,
      deploymentBlock: 14173395n,
    },
    relayerRegistry: {
      address: 0x58E8dCC13BE9780fC42E8723D8EaD4CF46943dF2n,
      deploymentBlock: 14173129n,
    },
    aggregator: {
      address: 0xE8F47A78A6D52D317D0D2FFFac56739fE14D1b49n
    },
    weth: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2n,
    uniswapQuoterV2: 0x61fFE014bA17989E743c5F6cB21bF9697530B21en,
  },
  11155111: {
    ensSubdomainKey: 'sepolia-tornado',
    instanceRegistry: {
      address: 0x4e69fD587118dFb64957d18654E3894118E9B1BFn,
      deploymentBlock: 5594611n,
    },
    relayerRegistry: {
      address: 0xD6663593E71e4916eCb6f6606e1A6FbfA1634ffAn,
      deploymentBlock: 5594660n,
    },
    aggregator: {
      address: 0x4088712AC9fad39ea133cdb9130E465d235e9642n
    },
    weth: 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14n,
    uniswapQuoterV2: 0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3n,
  }
} as const;
