import { IPaymasterConfig } from "./plugin/interfaces/protocol-params.interface";

// Protocol constants
export const E_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const E_ADDRESS_BIGINT = BigInt(E_ADDRESS);

export const TornadoPaymasterConfigs = {
  11155111: {
    bundlerUrl: 'https://public.pimlico.io/v2/11155111/rpc',
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    paymasterAddress: '0xA0e2667AcdECb9bCDa6Fcf87638a962e2E9dB20D',
    poolsAccountsMap: {
      '0x8c4a04d872a6c1be37964a21ba3a138525dff50b': '0x8A70E3dE493B8599447013f08d8b35719C8ED0ec',
      '0x8cc930096b4df705a007c4a039bdfa1320ed2508': '0x191e3De3cF7f61de7EbEf4Bf45cfBA4f652d1C6e',
      '0x6921fd1a97441dd603a997ed6ddf388658daf754': '0x060d053A6595630851ab873d6C95401b0C964d26'
    }
  },
  1: {

  } as never
} as const satisfies Record<number, IPaymasterConfig>;

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
