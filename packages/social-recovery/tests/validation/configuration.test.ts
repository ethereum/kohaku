import { describe, expect, it } from 'vitest';
import { validateRequest, validateSetup } from '../../src/index';
import { CANCEL, CANCEL_CONTEXT, CONFIGURATION, DRAFT, OPENING, REQUEST_CONTEXT, SETUP_CONTEXT } from './fixtures';

describe('validation and the client configuration', () => {
  it('judges no draft by the default wait or the cancel window', () => {
    const moved = { ...SETUP_CONTEXT, configuration: { ...CONFIGURATION, defaultWait: 1, cancelWindow: 1 } };

    expect(validateSetup(DRAFT, moved)).toEqual(validateSetup(DRAFT, SETUP_CONTEXT));
  });

  it('judges a cancellation window by the request window bounds, not by the cancel window', () => {
    const moved = { ...CANCEL_CONTEXT, configuration: { ...CONFIGURATION, cancelWindow: 60 } };

    expect(validateRequest(CANCEL, moved)).toEqual(validateRequest(CANCEL, CANCEL_CONTEXT));
  });

  it('reads the rule cost bound from the configuration at every value', () => {
    const costs = [{ method: DRAFT.clauses[0]!.credentials[0]!.method, gas: 1 }, { method: DRAFT.clauses[0]!.credentials[1]!.method, gas: 1 }];
    const at = (ruleCostBound: number) =>
      validateSetup(DRAFT, { ...SETUP_CONTEXT, costs, configuration: { ...CONFIGURATION, ruleCostBound } }).errors.map((finding) => finding.code);

    expect(at(1)).toEqual(['rule.too-wide']);
    expect(at(2)).toEqual([]);
  });

  it('reads the token allowlist from the configuration', () => {
    const empty = { ...REQUEST_CONTEXT, configuration: { ...CONFIGURATION, tokens: [] } };

    expect(validateRequest(OPENING, empty).warnings.map((finding) => finding.code)).toContain('payment.token-unknown');
  });
});
