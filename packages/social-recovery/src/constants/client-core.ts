import type { Hex } from '../interfaces/records';
import { FORMATS_ZERO_ADDRESS } from './formats';

/** The address a permissionless call's simulation runs from when the prepare names none. */
export const CLIENT_CORE_SIMULATION_FROM = FORMATS_ZERO_ADDRESS;

/** The setup commitment the manager holds for an account and action with no setup standing. */
export const CLIENT_CORE_NO_SETUP_COMMITMENT: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** The refusal message when no setup stands or no backup was kept with the current one. */
export const CLIENT_CORE_NO_BACKUP_MESSAGE = 'no backup to restore: no setup stands, or the current setup kept none';

/** The refusal message when the backup did not open under the password and the setup it is bound to. */
export const CLIENT_CORE_BACKUP_UNOPENED_MESSAGE = 'the backup did not open under this password and the current setup';

/** The refusal message when the restored configuration does not recompute to the committed setup. */
export const CLIENT_CORE_COMMITMENT_MISMATCH_MESSAGE =
  'the restored configuration does not recompute to the setup commitment the manager holds';
