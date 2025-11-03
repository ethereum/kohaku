import { Chain } from '../models/engine-types';
import { TXIDVersion } from '../models/poi-types';
import { isDefined } from './is-defined';

type ChainString = `${number}:${number}`;

/**
 * A simple nested datastructure that holds information per-chain and per
 * RailgunTXIDVersion.
 */
export class Registry<T> {
  private v2Map: Map<ChainString, T>;

  private v3Map: Map<ChainString, T>;

  private anyMap: Map<ChainString, T>;

  constructor() {
    this.v2Map = new Map();
    this.v3Map = new Map();
    this.anyMap = new Map();
  }

  private selectMap(txidVersion: TXIDVersion | null): Map<ChainString, T> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        return this.v2Map;
      case TXIDVersion.V3_PoseidonMerkle:
        return this.v3Map;
      default:
        return this.anyMap;
    }
  }

  private static serializeChain(chain: Chain): ChainString {
    return `${chain.type}:${chain.chainId}`;
  }

  private static deserializeChain(chainString: ChainString): Chain {
    const [type, chainId] = chainString.split(':').map(Number);

    if (type === undefined || chainId === undefined) {
      throw new Error(`Invalid chain string: ${chainString}`);
    }

    return { type, chainId };
  }

  set(txidVersion: TXIDVersion | null, chain: Chain, value: T) {
    this.selectMap(txidVersion).set(Registry.serializeChain(chain), value);
  }

  has(txidVersion: TXIDVersion | null, chain: Chain): boolean {
    return isDefined(this.get(txidVersion, chain));
  }

  get(txidVersion: TXIDVersion | null, chain: Chain): Optional<T> {
    return this.selectMap(txidVersion).get(Registry.serializeChain(chain));
  }

  getOrThrow(txidVersion: TXIDVersion | null, chain: Chain): T {
    const value = this.get(txidVersion, chain);

    if (!isDefined(value)) {
      const chainStr = Registry.serializeChain(chain);

      throw new Error(
        `No value found for txidVersion=${String(txidVersion)} and chain=${chainStr}`,
      );
    }

    return value;
  }

  del(txidVersion: TXIDVersion | null, chain: Chain) {
    this.selectMap(txidVersion).delete(Registry.serializeChain(chain));
  }

  forEach(callback: (value: T, txidVersion: TXIDVersion | null, chain: Chain) => void) {
    const taggedMaps: Array<[TXIDVersion | null, typeof this.v2Map]> = [
      [TXIDVersion.V2_PoseidonMerkle, this.v2Map],
      [TXIDVersion.V3_PoseidonMerkle, this.v3Map],
      [null, this.anyMap],
    ];

    for (const [txidVersion, map] of taggedMaps) {
      for (const [chainStr, value] of map) {
        const chain = Registry.deserializeChain(chainStr);

        callback(value, txidVersion, chain);
      }
    }
  }

  map<R>(callback: (value: T, txidVersion: TXIDVersion | null, chain: Chain) => R): R[] {
    const result: R[] = [];

    this.forEach((value, txidVersion, chain) => {
      result.push(callback(value, txidVersion, chain));
    });

    return result;
  }
}
