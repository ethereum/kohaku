import type { ActionInfo, Address, PreparedCall } from './records';

/** One recovery action contract's reads and its disarming write, bound to one account. */
export interface IRecoveryActionInteractor {
  supportsAccount(): Promise<boolean>;
  isAuthority(key: Address): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  holdsAnyPrivilege(candidate: Address): Promise<boolean>;
  actionInfo(): Promise<ActionInfo>;
  /** The account's privilege write taking the action's authorization back. */
  disarmingCall(): Promise<PreparedCall>;
}
