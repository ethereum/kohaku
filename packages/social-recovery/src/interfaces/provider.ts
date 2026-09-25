import type { Address, BlockHeader, BlockRange, BlockTag, FilterSpec, Hex, RawLog } from './records';

/** The integrator's chain access, the only way the SDK reaches a chain. */
export interface IProvider {
  chainId(): Promise<number>;
  /** One `eth_call`; rejects a reverted call with the raw revert data. */
  call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex>;
  /** One `eth_getLogs` over the filter and the range. */
  logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]>;
  block(tag: BlockTag): Promise<BlockHeader>;
  /** One `eth_getCode`; `0x` where the address holds no code. */
  code(address: Address, block: BlockTag): Promise<Hex>;
}
