import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertObject, assertUintNumber } from '../formats/guards';
import type { SetupDraft, ValidationResult } from '../interfaces';
import type { SetupValidationContext } from '../types/validation';
import { emptyFindings } from './common';
import { ruleCostFindings } from './setup-cost';
import { placedCredentials } from './setup-draft';
import { actionFindings, alreadyArmedFindings } from './setup-action';
import { methodFindings } from './setup-methods';
import { clauseShapeFindings, duplicateFindings, repeatedPersonFindings, ruleShapeFindings } from './setup-rule';
import { backupFindings, waitFindings } from './setup-wait-backup';

/** Refuses a context whose records or client numbers are not the shapes they declare. */
function assertSetupContext(context: SetupValidationContext): void {
  assertObject(context, 'context');
  assertObject(context.descriptor, 'context.descriptor');
  assertObject(context.configuration, 'context.configuration');

  const { maxWait, shortWait, ruleCostBound } = context.configuration;

  assertUintNumber(maxWait, FORMATS_SAFE_INTEGER_BITS, 'context.configuration.maxWait');
  assertUintNumber(shortWait, FORMATS_SAFE_INTEGER_BITS, 'context.configuration.shortWait');
  assertUintNumber(ruleCostBound, FORMATS_SAFE_INTEGER_BITS, 'context.configuration.ruleCostBound');

  if (context.descriptorOrigin !== 'kit' && context.descriptorOrigin !== 'integrator') {
    throw new TypeError('context.descriptorOrigin must be kit or integrator');
  }
}

/**
 * Every error and warning a setup draft reaches against the reads its client made, all of them at once.
 * Throws a TypeError or RangeError on a malformed argument and never on a finding.
 */
export function validateSetup(draft: SetupDraft, context: SetupValidationContext): ValidationResult {
  const credentials = placedCredentials(draft);

  assertSetupContext(context);

  const findings = emptyFindings();

  ruleShapeFindings(draft, findings);
  ruleCostFindings(draft, credentials, context.costs, context.configuration.ruleCostBound, findings);
  duplicateFindings(credentials, findings);
  waitFindings(draft, context, findings);
  actionFindings(context, findings);
  backupFindings(draft, credentials, context, findings);
  clauseShapeFindings(draft, credentials, findings);
  methodFindings(draft, credentials, context, findings);
  alreadyArmedFindings(context, findings);
  repeatedPersonFindings(credentials, findings);

  return findings;
}
