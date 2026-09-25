import type { Address, ModuleInfo, Parties, ReadResult } from './records';

/** The views every method module exposes. */
export interface IMethodModuleReads {
  moduleInfo(module: Address): Promise<ReadResult<ModuleInfo>>;
  paused(module: Address): Promise<ReadResult<boolean>>;
  trustedParties(module: Address): Promise<ReadResult<Parties>>;
}
