import { describe, expect, it } from 'vitest';
import {
  REQUEST_ERROR_CODES,
  REQUEST_WARNING_CODES,
  SETUP_ERROR_CODES,
  SETUP_WARNING_CODES,
  validateRequest,
  validateSetup,
  type ValidationResult,
} from '../../src/index';
import { CONFIGURATION, DRAFT, OPENING, REQUEST_CONTEXT, SETUP_CONTEXT } from './fixtures';
import { everyOpeningError, requestScenarios, setupScenarios } from './scenarios';

const sorted = (codes: Iterable<string>): string[] => [...new Set(codes)].sort();

/** The codes a gathering raises and neither validator does. */
const GATHERING_ONLY: readonly string[] = ['handover.removed-unknown', 'request.window-short', 'cancel.window-late'];

const setupResults = (): ValidationResult[] => setupScenarios().map(([, draft, context]) => validateSetup(draft, context));

const requestResults = (): ValidationResult[] => requestScenarios().map(([, request, context]) => validateRequest(request, context));

/** Deep-freezes a fixture so any write by the validator throws. */
function frozen<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach((member) => frozen(member));
    Object.freeze(value);
  }

  return value;
}

describe('the finding catalogue', () => {
  it('validateSetup produces exactly the setup error and warning codes across its scenarios', () => {
    const results = setupResults();

    expect(sorted(results.flatMap((result) => result.errors.map((finding) => finding.code)))).toEqual(sorted(SETUP_ERROR_CODES));
    expect(sorted(results.flatMap((result) => result.warnings.map((finding) => finding.code)))).toEqual(sorted(SETUP_WARNING_CODES));
  });

  it('validateRequest produces exactly the request codes but the three a gathering raises', () => {
    const results = requestResults();

    expect(sorted(results.flatMap((result) => result.errors.map((finding) => finding.code)))).toEqual(
      sorted(REQUEST_ERROR_CODES.filter((code) => !GATHERING_ONLY.includes(code))),
    );
    expect(sorted(results.flatMap((result) => result.warnings.map((finding) => finding.code)))).toEqual([
      'method.unshipped',
      'payment.insufficient',
      'payment.open-payee',
      'payment.sponsor-sees',
      'payment.token-unknown',
      'request.moment-skew',
    ]);
  });

  it('the union of both equals the four tuples minus handover.removed-unknown, request.window-short and cancel.window-late', () => {
    const produced = sorted([...setupResults(), ...requestResults()].flatMap((result) => [...result.errors, ...result.warnings].map((finding) => finding.code)));
    const tuples = sorted([...SETUP_ERROR_CODES, ...SETUP_WARNING_CODES, ...REQUEST_ERROR_CODES, ...REQUEST_WARNING_CODES]);

    expect(produced).toEqual(tuples.filter((code) => !GATHERING_ONLY.includes(code)));

    for (const code of GATHERING_ONLY) expect(produced).not.toContain(code);
  });

  it('no setup code comes from validateRequest and no request-only code from validateSetup', () => {
    const fromRequest = sorted(requestResults().flatMap((result) => [...result.errors, ...result.warnings].map((finding) => finding.code)));
    const fromSetup = sorted(setupResults().flatMap((result) => [...result.errors, ...result.warnings].map((finding) => finding.code)));
    const setupOnly = [...SETUP_ERROR_CODES, ...SETUP_WARNING_CODES].filter((code) => code !== 'method.unshipped');
    const requestOnly = [...REQUEST_ERROR_CODES, ...REQUEST_WARNING_CODES].filter((code) => code !== 'method.unshipped');

    expect(fromRequest.filter((code) => (setupOnly as readonly string[]).includes(code))).toEqual([]);
    expect(fromSetup.filter((code) => (requestOnly as readonly string[]).includes(code))).toEqual([]);
  });

  it('every error lands in errors and every warning in warnings', () => {
    const errors: readonly string[] = [...SETUP_ERROR_CODES, ...REQUEST_ERROR_CODES];
    const warnings: readonly string[] = [...SETUP_WARNING_CODES, ...REQUEST_WARNING_CODES];

    for (const result of [...setupResults(), ...requestResults()]) {
      for (const finding of result.errors) expect(errors).toContain(finding.code);

      for (const finding of result.warnings) expect(warnings).toContain(finding.code);
    }
  });

  it('returns every co-occurring setup error of a dead draft at once', () => {
    const [[, wide, wideContext], [, empty, emptyContext]] = setupScenarios() as [[string, typeof DRAFT, typeof SETUP_CONTEXT], [string, typeof DRAFT, typeof SETUP_CONTEXT]];

    expect(sorted(validateSetup(wide, wideContext).errors.map((finding) => finding.code))).toEqual([
      'action.unsupported',
      'backup.too-wide',
      'clause.empty',
      'clause.threshold-too-wide',
      'credential.duplicate',
      'rule.too-wide',
      'wait.above-maximum',
      'wait.field-width',
    ]);
    expect(sorted(validateSetup(empty, emptyContext).errors.map((finding) => finding.code))).toEqual([
      'action.unsupported',
      'rule.empty',
      'wait.above-maximum',
      'wait.field-width',
    ]);
  });

  it('returns every opening error of one request at once', () => {
    const [request, context] = everyOpeningError();

    expect(sorted(validateRequest(request, context).errors.map((finding) => finding.code))).toEqual([
      'handover.malformed',
      'handover.new-holds-privilege',
      'handover.removed-not-authority',
      'handover.same-authority',
      'proof.place-out-of-range',
      'proof.places-unordered',
      'request.attempt-active',
      'request.attempt-id',
      'request.body-mismatch',
      'request.expired',
      'request.method-stopped',
      'request.rule-unsatisfied',
    ]);
  });

  it('gives the same output for the same inputs and writes nothing into them', () => {
    for (const [, draft, context] of setupScenarios()) {
      expect(validateSetup(frozen(draft), frozen(context))).toEqual(validateSetup(draft, context));
    }

    for (const [, request, context] of requestScenarios()) {
      expect(validateRequest(frozen(request), frozen(context))).toEqual(validateRequest(request, context));
    }
  });

  it('throws a TypeError on a malformed argument and never a finding', () => {
    expect(() => validateSetup(null as never, SETUP_CONTEXT)).toThrow(TypeError);
    expect(() => validateSetup(DRAFT, null as never)).toThrow(TypeError);
    expect(() => validateSetup({ ...DRAFT, privacy: { publicMetadata: '0x', backup: 'paper' as never } }, SETUP_CONTEXT)).toThrow(TypeError);
    expect(() => validateRequest(null as never, REQUEST_CONTEXT)).toThrow(TypeError);
    expect(() => validateRequest(OPENING, { ...REQUEST_CONTEXT, handover: undefined })).toThrow(TypeError);
    expect(() => validateRequest(OPENING, { ...REQUEST_CONTEXT, configuration: { ...CONFIGURATION, tokens: 'all' as never } })).toThrow(TypeError);
  });
});
