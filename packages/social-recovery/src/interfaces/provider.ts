import type { Address, BlockHeader, BlockRange, BlockTag, FilterSpec, Hex, RawLog } from './records';

/**
 * The integrator's chain access, the only object the SDK reaches a chain
 * through (D-201, D-208).
 */
export interface IProvider {
  chainId(): Promise<number>;
  /** One `eth_call`; rejects a reverted call with the raw revert data. */
  call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex>;
  /** One `eth_getLogs` over the filter and the two blocks of the range. */
  logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]>;
  /** One block's number, timestamp and hash. */
  block(tag: BlockTag): Promise<BlockHeader>;
}
