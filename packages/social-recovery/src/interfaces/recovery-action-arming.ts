import type { PreparedCall } from './records';

/** Arms the recovery action on the account. */
export interface IRecoveryActionArming {
  /** The account's own write authorizing the action. */
  armingCall(): Promise<PreparedCall>;
}
