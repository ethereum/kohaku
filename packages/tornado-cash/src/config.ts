import { IPaymasterConfig } from "./plugin/interfaces/protocol-params.interface";

// Protocol constants
export const E_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const E_ADDRESS_BIGINT = BigInt(E_ADDRESS);

export const TornadoPaymasterConfigs = {
  11155111: {
    bundlerUrl: 'https://public.pimlico.io/v2/11155111/rpc',
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    paymasterAddress: '0x1c5aCCb9c09D72945b79EC986776136bE01d7B2F',
    poolsAccountsMap: {
      // pool -> per-pool TornadoFeeAdapter (eth_0_1, eth_1, dai_100)
      '0x8c4a04d872a6c1be37964a21ba3a138525dff50b': '0xa616aAE443FCCABfc2F1EA2Afe001E5046FFDCe0',
      '0x8cc930096b4df705a007c4a039bdfa1320ed2508': '0x67a898343F32641206d0f30CB3367944a8919A3A',
      '0x6921fd1a97441dd603a997ed6ddf388658daf754': '0xbF0a7969dacF8337716d0F283df0574dF56b0479'
    }
  },
  1: {
    bundlerUrl: 'https://public.pimlico.io/v2/1/rpc',
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    paymasterAddress: '0xe06CB96C57D2442f8F60F5017354BC08F7e91308',
    poolsAccountsMap: {
      // ETH 0.1
      '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc': '0x4a3F73a23563bB467Aa034d0fAB61e7BcDf26161',
      // ETH 1
      '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936': '0xC086b50Dd859Bb15D553327178DEdbC347B5b905',
      // ETH 10
      '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf': '0x08d1103bff53CBdC9DB1e81B79475CEad2e35870',
      // ETH 100
      '0xa160cdab225685da1d56aa342ad8841c3b53f291': '0x3aF851f9BeEeE6E9fa06022f34Dc4C453D265aE5',
      // DAI 100
      '0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3': '0xe6be288aeCa9FAB56D9792686Ec571Fb1AF37F55',
      // DAI 1_000
      '0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144': '0xf6f35246EbDA061bB17b6C7ED7B7049065eD61f3',
      // DAI 10_000
      '0x07687e702b410Fa43f4cB4Af7FA097918ffD2730': '0x36A5b4bCE77700B9C52cFEE53Fc8cA3B58eb7E35',
      // DAI 100_000
      '0x23773e65ed146a459791799d01336db287f25334': '0x83Ff713F0939409E1c6023bc8aaB3E49eD968c8D',
      // USDC 100
      '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d': '0xB1C7e712AF153073979AdC5ef8B1Cc5A7b0cf031',
      // USDC 1_000
      '0xd96f2b1c14db8458374d9aca76e26c3d18364307': '0x44336242f9766b4c751F6958499C5cc18325e25B',
      // USDT 100
      '0x169ad27a470d064dede56a2d3ff727986b15d52b': '0xF006862cCa4829D3f3ddD52d93fC49C03D380a5F',
      // USDT 1_000
      '0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f': '0x5DF524b6c9303eD94A7767c2eD787ee223c9bC54',
      // WBTC 0.1
      '0x178169b423a011fff22b9e3f3abea13414ddd0f1': '0x0fdF2f686B600523F9752aEca0abb6AD9603A22C',
      // WBTC 1
      '0x610b717796ad172b316836ac95a2ffad065ceab4': '0xec3Cca694EEe55808B3f5EFEDd0bC03E52e47834',
      // WBTC 10
      '0xbb93e510bbcd0b7beb5a853875f9ec60275cf498': '0xC2C427E6ADF66F412921C17958CeDD9C7710F521'
    }
  }
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
  }
} as const;
