import type { Address, ModuleInfo, Parties, ReadResult } from './records';

/**
 * The read seam over the manager part's three method module views, handed out
 * by the builder's `methodModuleReads()` (D-201, D-202).
 */
export interface IMethodModuleReads {
  /** Whether the read was answered at all, beside what it answered. */
  moduleInfo(module: Address): Promise<ReadResult<ModuleInfo>>;
  /** Whether the read was answered at all, beside the two-valued stop reading. */
  paused(module: Address): Promise<ReadResult<boolean>>;
  /** Whether the read was answered at all, beside the five declared values. */
  trustedParties(module: Address): Promise<ReadResult<Parties>>;
}
