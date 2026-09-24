import type { PreparedCall } from './records';

/**
 * The arming seam over the action part, which the builder hands to the setup
 * client alone (D-201, D-202).
 */
export interface IRecoveryActionArming {
  /** The account's own write authorizing the action. */
  armingCall(): Promise<PreparedCall>;
}
