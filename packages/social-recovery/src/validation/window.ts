import { FORMATS_SAFE_INTEGER_BITS, FORMATS_VALID_UNTIL_BITS, VALIDATION_MOMENT_SKEW_SECONDS } from '../constants';
import { assertObject, assertUintNumber } from '../formats/guards';
import type { Moment, RequestWindowBounds, ValidationError, ValidationResult, ValidationWarning } from '../interfaces';
import type { WindowFacts } from '../types/validation';

/** Refuses window facts or a moment that are not non-negative safe integers. */
function assertWindowInputs(facts: WindowFacts, moment: Moment): void {
  assertObject(facts, 'facts');
  assertUintNumber(facts.validUntil, FORMATS_VALID_UNTIL_BITS, 'facts.validUntil');
  assertUintNumber(facts.blockTimestamp, FORMATS_SAFE_INTEGER_BITS, 'facts.blockTimestamp');
  assertUintNumber(moment, FORMATS_SAFE_INTEGER_BITS, 'moment');

  if (facts.consumableAfter !== undefined) {
    assertUintNumber(facts.consumableAfter, FORMATS_VALID_UNTIL_BITS, 'facts.consumableAfter');
  }
}

/** The window's width in seconds from the pinned block's timestamp to its deadline, negative once the deadline is behind it. */
export const requestWindowWidth = (facts: WindowFacts): number => facts.validUntil - facts.blockTimestamp;

/**
 * The findings a request reaches at submission from its window and the moment alone:
 * `request.expired` once the moment or the pinned block's timestamp is past `validUntil`, and `request.moment-skew` past
 * `VALIDATION_MOMENT_SKEW_SECONDS` from the block's timestamp.
 * Throws a TypeError or RangeError on a malformed argument and never on a finding.
 */
export function submissionFindings(facts: WindowFacts, moment: Moment): ValidationResult {
  assertWindowInputs(facts, moment);

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const { validUntil, blockTimestamp } = facts;

  if (moment > validUntil || blockTimestamp > validUntil) {
    errors.push({ code: 'request.expired', subject: 'request', values: { validUntil, moment, blockTimestamp } });
  }

  if (Math.abs(moment - blockTimestamp) > VALIDATION_MOMENT_SKEW_SECONDS) {
    warnings.push({
      code: 'request.moment-skew',
      subject: 'request',
      values: { moment, blockTimestamp, span: VALIDATION_MOMENT_SKEW_SECONDS },
    });
  }

  return { errors, warnings };
}

/**
 * The findings a gathering's window reaches from its own values, the moment and the client's window bounds alone:
 * those of `submissionFindings`, `request.window-short` under `bounds.floor`, and
 * `cancel.window-late` where a cancellation's window ends after `consumableAfter`.
 * Throws a TypeError or RangeError on a malformed argument and never on a finding.
 */
export function windowFindings(facts: WindowFacts, moment: Moment, bounds: RequestWindowBounds): ValidationResult {
  const submission = submissionFindings(facts, moment);

  assertObject(bounds, 'bounds');
  assertUintNumber(bounds.floor, FORMATS_SAFE_INTEGER_BITS, 'bounds.floor');

  const warnings: ValidationWarning[] = [];
  const { validUntil, consumableAfter } = facts;
  const window = requestWindowWidth(facts);

  if (window < bounds.floor) {
    warnings.push({ code: 'request.window-short', subject: 'request', values: { window, floor: bounds.floor } });
  }

  warnings.push(...submission.warnings);

  if (consumableAfter !== undefined && validUntil > consumableAfter) {
    warnings.push({ code: 'cancel.window-late', subject: 'request', values: { validUntil, consumableAfter } });
  }

  return { errors: submission.errors, warnings };
}
