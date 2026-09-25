/** The setup error codes. */
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

/** The setup warning codes. */
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

/** The request error codes. */
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

/** The request warning codes; `method.unshipped` is shared with the setup warnings. */
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

/** The restore cause codes. */
export const RESTORE_CAUSE_CODES = ['restore.no-backup', 'restore.backup-unopened', 'restore.commitment-mismatch'] as const;

export type ErrorCode = (typeof SETUP_ERROR_CODES)[number] | (typeof REQUEST_ERROR_CODES)[number];

export type WarningCode = (typeof SETUP_WARNING_CODES)[number] | (typeof REQUEST_WARNING_CODES)[number];

export type RestoreCauseCode = (typeof RESTORE_CAUSE_CODES)[number];

/** What a finding is about. */
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

/** A finding's values by name. */
export type FindingValues = { readonly [name: string]: FindingValue };

/** A finding that blocks the prepare. */
export type ValidationError = {
  readonly code: ErrorCode;
  readonly subject: FindingSubject;
  readonly values: FindingValues;
};

/** A finding disclosed and never refused. */
export type ValidationWarning = {
  readonly code: WarningCode;
  readonly subject: FindingSubject;
  readonly values: FindingValues;
};

export type Finding = ValidationError | ValidationWarning;

/** What `validateSetup` and `validateRequest` return. */
export type ValidationResult = {
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
};
