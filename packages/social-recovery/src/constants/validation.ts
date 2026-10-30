import { FORMATS_THRESHOLD_BITS, FORMATS_WAIT_BITS } from './formats';

/** How far, in seconds, the caller's moment may sit from the pinned block's timestamp before the two are said to disagree. */
export const VALIDATION_MOMENT_SKEW_SECONDS = 900;

/** The largest threshold the setup body's threshold field holds. */
export const VALIDATION_THRESHOLD_MAX = 2 ** FORMATS_THRESHOLD_BITS - 1;

/** The largest timestamp the manager's `consumableAfter` field holds, in seconds. */
export const VALIDATION_TIMESTAMP_MAX = 2 ** FORMATS_WAIT_BITS - 1;

/** The ways a token outside the allowlist lets the handover land while nobody is paid. */
export const VALIDATION_UNKNOWN_TOKEN_SHAPES = ['returns-false', 'no-code', 'accepting-fallback'] as const;
