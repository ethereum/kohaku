import type { AttemptRequest, CancelRequest, ValidationResult } from '../interfaces';
import type { HandoverReads, RequestValidationContext } from '../types/validation';
import { addAll, emptyFindings } from './common';
import { handoverFindings } from './request-handover';
import { assertRequestContext, checkedRequest } from './request-parse';
import { paymentFindings } from './request-payment';
import { placeOrderFindings, ruleCountFindings, stoppedFindings, unservedFindings } from './request-proofs';
import { stateFindings } from './request-state';
import { submissionFindings } from './window';

/**
 * Every error and warning an assembled request reaches against the reads its client made, all of them at once.
 * Throws a TypeError or RangeError on a malformed argument and never on a finding.
 */
export function validateRequest(request: AttemptRequest | CancelRequest, context: RequestValidationContext): ValidationResult {
  const checked = checkedRequest(request);

  assertRequestContext(context, checked.opening);

  const findings = emptyFindings();
  const facts = { validUntil: checked.validUntil, blockTimestamp: context.block.timestamp };

  stateFindings(checked, context.state, findings);
  addAll(findings, submissionFindings(facts, context.moment));
  ruleCountFindings(checked, findings);
  stoppedFindings(checked, context, findings);
  placeOrderFindings(checked, findings);

  if (checked.opening) {
    handoverFindings(context.handover as HandoverReads, findings);
    paymentFindings(checked.order, context, findings);
  }

  unservedFindings(checked, context, findings);

  return findings;
}
