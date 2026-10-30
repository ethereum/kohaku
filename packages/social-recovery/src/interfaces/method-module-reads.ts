import type { Address, ModuleInfo, Parties, PinnedBlock, ReadResult } from './records';

/**
 * The views every method module exposes; the optional `block` pins a read to that block instead of the read tag's.
 * A passed block is used as given: reads pin by its number and a prepare reports its hash unverified.
 */
export interface IMethodModuleReads {
  moduleInfo(module: Address, block?: PinnedBlock): Promise<ReadResult<ModuleInfo>>;
  paused(module: Address, block?: PinnedBlock): Promise<ReadResult<boolean>>;
  trustedParties(module: Address, block?: PinnedBlock): Promise<ReadResult<Parties>>;
}
