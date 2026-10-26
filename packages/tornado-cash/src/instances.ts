import type { IPool } from './data/interfaces/events.interface';
import type { Address } from './interfaces/types.interface';

/**
 * A Tornado instance the plugin may deposit into. `asset` is `0n` for native ETH.
 */
export interface ITornadoInstance {
  address: Address;
  asset: Address;
  symbol: string;
  decimals: number;
  denomination: bigint;
}

const ETH = { asset: 0n, symbol: 'ETH', decimals: 18 } as const;
const DAI = { asset: 0x6B175474E89094C44Da98b954EedeAC495271d0Fn, symbol: 'DAI', decimals: 18 } as const;
const CDAI = { asset: 0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643n, symbol: 'cDAI', decimals: 8 } as const;
const USDC = { asset: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48n, symbol: 'USDC', decimals: 6 } as const;
const USDT = { asset: 0xdAC17F958D2ee523a2206206994597C13D831ec7n, symbol: 'USDT', decimals: 6 } as const;
const WBTC = { asset: 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599n, symbol: 'WBTC', decimals: 8 } as const;
const SEPOLIA_DAI = { asset: 0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357n, symbol: 'DAI', decimals: 18 } as const;

/**
 * Static catalog of Tornado instances per chain. Pool addresses and
 * denominations served by the RPC (instance registry, `denomination()`) are only
 * accepted when they match an entry here, so a lying RPC cannot add a deposit
 * target. Checked against `denomination()`/`token()` on each instance and the
 * mainnet instance registry.
 */
export const TornadoInstances = {
  1: [
    { address: 0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fcn, ...ETH, denomination: 10n ** 17n }, // 0.1 ETH
    { address: 0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936n, ...ETH, denomination: 10n ** 18n }, // 1 ETH
    { address: 0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbFn, ...ETH, denomination: 10n ** 19n }, // 10 ETH
    { address: 0xA160cdAB225685dA1d56aa342Ad8841c3b53f291n, ...ETH, denomination: 10n ** 20n }, // 100 ETH
    // Extended ETH pools (see ExtendedEthPools)
    { address: 0x199112eb461ea7eec1d75b33343542e1d069b41cn, ...ETH, denomination: 10n ** 16n }, // 0.01 ETH
    { address: 0x398971a7ae0fed4ae435f353ef00d3d4e4c18fd4n, ...ETH, denomination: 3n * 10n ** 16n }, // 0.03 ETH
    { address: 0xf22487b84a618192aa68c0e1da24e9bbd892f774n, ...ETH, denomination: 3n * 10n ** 17n }, // 0.3 ETH
    { address: 0x74185a3f30b873c0ce1f4257298d1cda61be2f9fn, ...ETH, denomination: 3n * 10n ** 18n }, // 3 ETH
    { address: 0xc11197f71c7730c8b5db7c84191e07575f1db896n, ...ETH, denomination: 3n * 10n ** 19n }, // 30 ETH
    { address: 0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3n, ...DAI, denomination: 10n ** 20n }, // 100 DAI
    { address: 0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144n, ...DAI, denomination: 10n ** 21n }, // 1_000 DAI
    { address: 0x07687e702b410Fa43f4cB4Af7FA097918ffD2730n, ...DAI, denomination: 10n ** 22n }, // 10_000 DAI
    { address: 0x23773E65ed146A459791799d01336DB287f25334n, ...DAI, denomination: 10n ** 23n }, // 100_000 DAI
    { address: 0x22aaA7720ddd5388A3c0A3333430953C68f1849bn, ...CDAI, denomination: 5n * 10n ** 11n }, // 5_000 cDAI
    { address: 0x03893a7c7463AE47D46bc7f091665f1893656003n, ...CDAI, denomination: 5n * 10n ** 12n }, // 50_000 cDAI
    { address: 0x2717c5e28cf931547B621a5dddb772Ab6A35B701n, ...CDAI, denomination: 5n * 10n ** 13n }, // 500_000 cDAI
    { address: 0xD21be7248e0197Ee08E0c20D4a96DEBdaC3D20Afn, ...CDAI, denomination: 5n * 10n ** 14n }, // 5_000_000 cDAI
    { address: 0xd96f2B1c14Db8458374d9Aca76E26c3D18364307n, ...USDC, denomination: 10n ** 8n }, // 100 USDC
    { address: 0x4736dCf1b7A3d580672CcE6E7c65cd5cc9cFBa9Dn, ...USDC, denomination: 10n ** 9n }, // 1_000 USDC
    { address: 0x169AD27A470D064DEDE56a2D3ff727986b15D52Bn, ...USDT, denomination: 10n ** 8n }, // 100 USDT
    { address: 0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872fn, ...USDT, denomination: 10n ** 9n }, // 1_000 USDT
    { address: 0x178169B423a011fff22B9e3F3abeA13414dDD0F1n, ...WBTC, denomination: 10n ** 7n }, // 0.1 WBTC
    { address: 0x610B717796ad172B316836AC95a2ffad065CeaB4n, ...WBTC, denomination: 10n ** 8n }, // 1 WBTC
    { address: 0xbB93e510BbCD0B7beb5A853875f9eC60275CF498n, ...WBTC, denomination: 10n ** 9n }, // 10 WBTC
  ],
  11155111: [
    { address: 0x8C4A04d872a6C1BE37964A21ba3a138525dFF50bn, ...ETH, denomination: 10n ** 17n }, // 0.1 ETH
    { address: 0x8cc930096B4Df705A007c4A039BDFA1320Ed2508n, ...ETH, denomination: 10n ** 18n }, // 1 ETH
    // Extended ETH pools (see ExtendedEthPools)
    { address: 0x0E999C5285141ccB6dFaE68A0921F37ABd3e6A87n, ...ETH, denomination: 10n ** 16n }, // 0.01 ETH
    { address: 0x9480Be3964642efcD6CeBdb3570db8dC0f788908n, ...ETH, denomination: 3n * 10n ** 16n }, // 0.03 ETH
    { address: 0x83091415b54d764E215153Ff54B36cCd44122e6en, ...ETH, denomination: 3n * 10n ** 17n }, // 0.3 ETH
    { address: 0x7eE90edc51c3739Af3ee277e09ADE3F3d6bad4AFn, ...ETH, denomination: 3n * 10n ** 18n }, // 3 ETH
    { address: 0x8d10d506d29fc62abb8a290b99f66db27fc43585n, ...ETH, denomination: 10n ** 19n }, // 10 ETH
    { address: 0x3d1C943dfb2C8d9905B0Da0AFD18615915fF343An, ...ETH, denomination: 3n * 10n ** 19n }, // 30 ETH
    { address: 0x6921fd1a97441dd603a997ED6DDF388658daf754n, ...SEPOLIA_DAI, denomination: 10n ** 20n }, // 100 DAI
  ],
} as const satisfies Record<number, readonly ITornadoInstance[]>;

export type InstanceCatalog = ReadonlyMap<Address, ITornadoInstance>;

/**
 * Instances deposits may target on `chainId`: `override` when the integrator
 * passed `protocolConfig.instances`, else the built-in list. `undefined` means
 * no catalog for the chain, so deposits are refused.
 */
export const instanceCatalog = (
  chainId: bigint,
  override?: readonly ITornadoInstance[],
): InstanceCatalog | undefined => {
  const instances = override ?? TornadoInstances[Number(chainId) as keyof typeof TornadoInstances];

  return instances && new Map(instances.map((instance) => [instance.address, instance]));
};

/** The catalog entry for `pool`, if its address, asset and denomination all match it. */
export const catalogInstanceFor = (
  catalog: InstanceCatalog,
  { address, asset, isERC20, denomination }: Pick<IPool, 'address' | 'asset' | 'isERC20' | 'denomination'>,
): ITornadoInstance | undefined => {
  const instance = catalog.get(address);

  if (
    !instance ||
    instance.asset !== asset ||
    instance.denomination !== denomination ||
    (instance.asset !== 0n) !== isERC20
  ) {
    return undefined;
  }

  return instance;
};
