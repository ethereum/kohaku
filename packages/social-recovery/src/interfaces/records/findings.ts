// The two finding sets and the three restore causes of D-205, codes and
// values and never sentences (D-205 l.986, l.994). Line numbers are
// design/offchain/sdk.md.

/** The setup errors table, in its order (D-205 l.1009-1021). */
export const SETUP_ERROR_CODES = [
  'rule.empty',
  'clause.empty',
  'rule.all-thresholds-zero',
  'clause.threshold-above-count',
  'clause.threshold-too-wide',
  'rule.too-wide',
  'credential.duplicate',
  'wait.field-width',
  'wait.above-maximum',
  'action.unsupported',
  'backup.too-wide',
] as const;

/** The setup warnings table, in its order (D-205 l.1025-1041). */
export const SETUP_WARNING_CODES = [
  'clause.single-point',
  'clause.threshold-zero',
  'clause.shared-failure',
  'clause.secondary-only',
  'method.unshipped',
  'method.no-declaration',
  'method.stopped',
  'action.unaudited',
  'action.fit-unchecked',
  'manager.already-armed',
  'setup.wait-short',
  'setup.wait-zero',
  'backup.clear',
  'backup.empty',
  'rule.repeated-person',
] as const;

/** The request errors table, in its order (D-205 l.1047-1062). */
export const REQUEST_ERROR_CODES = [
  'request.attempt-id',
  'request.expired',
  'request.attempt-active',
  'request.no-active-attempt',
  'request.stale-attempt',
  'request.body-mismatch',
  'request.rule-unsatisfied',
  'request.method-stopped',
  'proof.places-unordered',
  'handover.removed-not-authority',
  'handover.new-holds-privilege',
  'handover.same-authority',
  'handover.malformed',
  'handover.removed-unknown',
] as const;

/** The request warnings table, in its order; `method.unshipped` is the setup code at the second moment (D-205 l.1068-1078). */
export const REQUEST_WARNING_CODES = [
  'payment.insufficient',
  'method.unshipped',
  'payment.open-payee',
  'payment.token-unknown',
  'request.window-wide',
  'request.window-short',
  'request.moment-skew',
  'cancel.window-late',
  'payment.sponsor-sees',
] as const;

/** The three restore causes (D-205 l.1088-1092). */
export const RESTORE_CAUSE_CODES = ['restore.no-backup', 'restore.backup-unopened', 'restore.commitment-mismatch'] as const;

export type ErrorCode = (typeof SETUP_ERROR_CODES)[number] | (typeof REQUEST_ERROR_CODES)[number];

export type WarningCode = (typeof SETUP_WARNING_CODES)[number] | (typeof REQUEST_WARNING_CODES)[number];

export type RestoreCauseCode = (typeof RESTORE_CAUSE_CODES)[number];

/** What a finding is about, the subject column of the four tables and the restore table (D-205 l.1009-1092). */
export const FINDING_SUBJECTS = [
  'setup',
  'clause',
  'credential',
  'action',
  'account',
  'request',
  'payment',
  'restore',
] as const;

export type FindingSubject = (typeof FINDING_SUBJECTS)[number];

/** One concrete value behind a finding: integers as bigint or number, addresses and bytes as hex. */
export type FindingValue = bigint | number | boolean | string | readonly FindingValue[] | FindingValues;

/** The values column of a finding's row, by name. */
export type FindingValues = { readonly [name: string]: FindingValue };

/** A finding that blocks the prepare: a stable code, its subject and its values (D-205 l.994, l.996-999). */
export type ValidationError = {
  readonly code: ErrorCode;
  readonly subject: FindingSubject;
  readonly values: FindingValues;
};

/** A finding disclosed and never refused (D-205 l.1001, l.1084). */
export type ValidationWarning = {
  readonly code: WarningCode;
  readonly subject: FindingSubject;
  readonly values: FindingValues;
};

export type Finding = ValidationError | ValidationWarning;

/** What `validateSetup` and `validateRequest` return, errors and warnings together (D-205 l.994, l.1003, usage l.445). */
export type ValidationResult = {
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
};
