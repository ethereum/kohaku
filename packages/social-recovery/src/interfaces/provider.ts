import type { Address, BlockHeader, BlockRange, BlockTag, FilterSpec, Hex, RawLog, RawTransaction } from './records';

/** The integrator's chain access, the only way the SDK reaches a chain. */
export interface IProvider {
  chainId(): Promise<number>;
  /** One `eth_call`; rejects a reverted call with a `ProviderRevert`. */
  call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex>;
  /** One `eth_getLogs` over the filter and the range. */
  logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]>;
  block(tag: BlockTag): Promise<BlockHeader>;
  /** One `eth_getCode`; `0x` where the address holds no code. */
  code(address: Address, block: BlockTag): Promise<Hex>;
  /** One `eth_getTransactionByHash`; `undefined`, or the node's `null` passed through, where the node knows no such transaction. */
  transaction(hash: Hex): Promise<RawTransaction | undefined>;
}
