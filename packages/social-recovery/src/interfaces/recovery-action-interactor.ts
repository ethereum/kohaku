import type { ActionInfo, Address, PinnedBlock, PreparedCall } from './records';

/**
 * One recovery action contract's reads and its disarming write, bound to one account; each reads or pins at `block` where one is passed.
 * A passed block is used as given: reads pin by its number and a prepare reports its hash unverified.
 */
export interface IRecoveryActionInteractor {
  supportsAccount(block?: PinnedBlock): Promise<boolean>;
  isAuthority(key: Address, block?: PinnedBlock): Promise<boolean>;
  isAuthorized(block?: PinnedBlock): Promise<boolean>;
  holdsAnyPrivilege(candidate: Address, block?: PinnedBlock): Promise<boolean>;
  actionInfo(block?: PinnedBlock): Promise<ActionInfo>;
  /** The account's privilege write taking the action's authorization back, pinned at `block` where one is passed. */
  disarmingCall(block?: PinnedBlock): Promise<PreparedCall>;
}
