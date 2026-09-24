import type { ActionInfo, Address, PreparedCall } from './records';

/**
 * The shared part for one action contract, bound to the account, handed out by
 * the builder's `recoveryAction()` (D-201, D-202). `AmbireRecoveryAction` is the
 * shipped implementation.
 */
export interface IRecoveryActionInteractor {
  supportsAccount(): Promise<boolean>;
  isAuthority(key: Address): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  holdsAnyPrivilege(candidate: Address): Promise<boolean>;
  actionInfo(): Promise<ActionInfo>;
  /** The account's privilege write taking the action's authorization back. */
  disarmingCall(): Promise<PreparedCall>;
}
