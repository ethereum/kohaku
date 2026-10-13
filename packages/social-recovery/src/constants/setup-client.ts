import type { AttemptState } from '../interfaces/records';

/** The attempt state in which an attempt is live: started, neither cancelled nor consumed. */
export const SETUP_CLIENT_LIVE_ATTEMPT_STATE: AttemptState = 'Waiting';

/** The refusal message when an encrypted backup's serialized configuration is longer than the padding it is sealed in. */
export const SETUP_CLIENT_BACKUP_TOO_WIDE_MESSAGE = 'the draft keeps an encrypted backup its configuration is too wide to seal';

/** The refusal message of a prepare on a client built for a deployment version this build does not serve. */
export const SETUP_CLIENT_VERSION_ESCAPED_MESSAGE =
  'this client prepares nothing: the deployment answers a version this build does not serve';

/** The refusal message when the draft keeps an encrypted backup and no password is given. */
export const SETUP_CLIENT_PASSWORD_MISSING_MESSAGE = 'the draft keeps an encrypted backup, which needs a password';

/** The refusal message when a password is given beside a draft that keeps no encrypted backup. */
export const SETUP_CLIENT_PASSWORD_UNUSED_MESSAGE = 'a password was given, but the draft keeps a clear or an empty backup';

/** The refusal message when the draft does not recompute to the commitment the prepared commit carries. */
export const SETUP_CLIENT_COMMITMENT_UNMATCHED_MESSAGE =
  'the draft does not recompute to the setup commitment the prepared commit carries';

/** The refusal message when the prepared commit is addressed to another manager than the client's. */
export const SETUP_CLIENT_OTHER_MANAGER_MESSAGE = 'the prepared commit is addressed to another manager than this client reads';
