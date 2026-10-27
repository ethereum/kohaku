import type { IPaymasterConfig } from "./plugin/interfaces/protocol-params.interface";
import type { Address } from "./interfaces/types.interface";

// Protocol constants
export const E_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const E_ADDRESS_BIGINT = BigInt(E_ADDRESS);

export const TornadoPaymasterConfigs = {
  11155111: {
    bundlerUrl: 'https://public.pimlico.io/v2/11155111/rpc',
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    paymasterAddress: '0x835ce2da8ad0d1f5d5a8462a58594006514c39b0',
    supportedPools: [
      '0x0E999C5285141ccB6dFaE68A0921F37ABd3e6A87', // ETH 0.01
      '0x9480Be3964642efcD6CeBdb3570db8dC0f788908', // ETH 0.03
      '0x8C4A04d872a6C1BE37964A21ba3a138525dFF50b', // ETH 0.1
      '0x83091415b54d764E215153Ff54B36cCd44122e6e', // ETH 0.3
      '0x8cc930096B4Df705A007c4A039BDFA1320Ed2508', // ETH 1
      '0x7eE90edc51c3739Af3ee277e09ADE3F3d6bad4AF', // ETH 3
      '0x8D10d506D29Fc62ABb8A290B99F66dB27Fc43585', // ETH 10
      '0x3d1C943dfb2C8d9905B0Da0AFD18615915fF343A', // ETH 30
      '0x6921fd1a97441dd603a997ED6DDF388658daf754', // DAI 100
    ],
  },
  1: {
    bundlerUrl: 'https://public.pimlico.io/v2/1/rpc',
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    paymasterAddress: '0xB0FfCdC890E969579D348F519a9C3920C2DD04a5',
    supportedPools: [
      '0x199112eb461ea7eec1d75b33343542e1d069b41c', // ETH 0.01
      '0x398971a7ae0fed4ae435f353ef00d3d4e4c18fd4', // ETH 0.03
      '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc', // ETH 0.1
      '0xf22487b84a618192aa68c0e1da24e9bbd892f774', // ETH 0.3
      '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', // ETH 1
      '0x74185a3f30b873c0ce1f4257298d1cda61be2f9f', // ETH 3
      '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf', // ETH 10
      '0xc11197f71c7730c8b5db7c84191e07575f1db896', // ETH 30
      '0xa160cdab225685da1d56aa342ad8841c3b53f291', // ETH 100
      '0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3', // DAI 100
      '0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144', // DAI 1,000
      '0x07687e702b410Fa43f4cB4Af7FA097918ffD2730', // DAI 10,000
      '0x23773e65ed146a459791799d01336db287f25334', // DAI 100,000
      '0xd96f2b1c14db8458374d9aca76e26c3d18364307', // USDC 100
      '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d', // USDC 1,000
      '0x169ad27a470d064dede56a2d3ff727986b15d52b', // USDT 100
      '0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f', // USDT 1,000
      '0x178169b423a011fff22b9e3f3abea13414ddd0f1', // WBTC 0.1
      '0x610b717796ad172b316836ac95a2ffad065ceab4', // WBTC 1
      '0xbb93e510bbcd0b7beb5a853875f9ec60275cf498', // WBTC 10
    ],
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

/**
 * Extra ETH denominations deployed outside the Tornado instance registry.
 * When a pool later appears in `getAllInstanceAddresses`, sync uses the
 * registry record instead of these addresses' contract fallback.
 */
export const ExtendedEthPools = {
  1: [
    0x199112eb461ea7eec1d75b33343542e1d069b41cn, // 0.01 ETH
    0x398971a7ae0fed4ae435f353ef00d3d4e4c18fd4n, // 0.03 ETH
    0xf22487b84a618192aa68c0e1da24e9bbd892f774n, // 0.3 ETH
    0x74185a3f30b873c0ce1f4257298d1cda61be2f9fn, // 3 ETH
    0xc11197f71c7730c8b5db7c84191e07575f1db896n, // 30 ETH
  ],
  11155111: [
    0x0E999C5285141ccB6dFaE68A0921F37ABd3e6A87n, // 0.01 ETH
    0x9480Be3964642efcD6CeBdb3570db8dC0f788908n, // 0.03 ETH
    0x83091415b54d764E215153Ff54B36cCd44122e6en, // 0.3 ETH
    0x7eE90edc51c3739Af3ee277e09ADE3F3d6bad4AFn, // 3 ETH
    0x8d10d506d29fc62abb8a290b99f66db27fc43585n, // 10 ETH
    0x3d1C943dfb2C8d9905B0Da0AFD18615915fF343An, // 30 ETH
  ],
} as const satisfies Record<number, readonly bigint[]>;

export const extendedEthPoolSet = (chainId: bigint): Set<Address> => {
  const pools = ExtendedEthPools[Number(chainId) as keyof typeof ExtendedEthPools] ?? [];

  return new Set(pools.map((address) => address as Address));
};
