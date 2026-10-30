import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { submissionFindings, validateRequest, windowFindings, type RequestWindowBounds } from '../../src/index';
import { TIMEOUT, run } from '../formats/arbitraries';
import { CANCEL, CANCEL_CONTEXT, CONFIGURATION, OPENING, REQUEST_CONTEXT, T, WAITING_STATE } from './fixtures';

const SHARED = ['request.expired', 'request.window-short', 'request.moment-skew', 'cancel.window-late'];

/** The four shared codes evaluated from their definitions, without the helper. */
function expectedCodes(validUntil: number, timestamp: number, moment: number, floor: number, consumableAfter?: number): string[] {
  const codes: string[] = [];

  if (moment > validUntil || timestamp > validUntil) codes.push('request.expired');

  if (validUntil - timestamp < floor) codes.push('request.window-short');

  if (moment - timestamp > 900 || timestamp - moment > 900) codes.push('request.moment-skew');

  if (consumableAfter !== undefined && validUntil > consumableAfter) codes.push('cancel.window-late');

  return codes.sort();
}

/** Offsets clustered around each boundary so both sides are reached often. */
const near = (edge: number) => fc.integer({ min: -3, max: 3 }).map((delta) => edge + delta);
const offset = fc.oneof(fc.integer({ min: -400_000, max: 400_000 }), near(0), near(900), near(-900), near(3_600));

const inputs = fc.record({
  validUntil: offset.map((delta) => T + delta),
  moment: offset.map((delta) => T + delta),
  floor: fc.oneof(fc.constant(3_600), fc.integer({ min: 0, max: 100_000 })),
  consumableAfter: fc.option(offset.map((delta) => T + delta), { nil: undefined }),
});

const bounds = (floor: number): RequestWindowBounds => ({ default: floor, floor });

const shared = (codes: readonly string[]): string[] => codes.filter((code) => SHARED.includes(code)).sort();

describe('the shared window codes', () => {
  it('windowFindings raises all four codes as an independent evaluation does', () => {
    run(fc.property(inputs, ({ validUntil, moment, floor, consumableAfter }) => {
      const facts = { validUntil, blockTimestamp: T, ...(consumableAfter === undefined ? {} : { consumableAfter }) };
      const result = windowFindings(facts, moment, bounds(floor));

      expect([...result.errors, ...result.warnings].map((finding) => finding.code).sort()).toEqual(
        expectedCodes(validUntil, T, moment, floor, consumableAfter),
      );
    }));
  }, TIMEOUT);

  it('validateRequest raises the submission helper\'s expired and skew findings and never window-short or cancel.window-late', () => {
    run(fc.property(inputs, fc.boolean(), ({ validUntil, moment, floor, consumableAfter }, opening) => {
      const configuration = { ...CONFIGURATION, requestWindow: bounds(floor) };
      const spendable = consumableAfter ?? T + 172_800;
      const state = { ...WAITING_STATE, attempt: { ...WAITING_STATE.attempt, consumableAfter: spendable } };
      const result = opening
        ? validateRequest({ ...OPENING, validUntil }, { ...REQUEST_CONTEXT, moment, configuration })
        : validateRequest({ ...CANCEL, validUntil }, { ...CANCEL_CONTEXT, moment, configuration, state });
      const helper = submissionFindings({ validUntil, blockTimestamp: T }, moment);
      const pick = (findings: readonly { code: string }[]) => findings.filter((finding) => SHARED.includes(finding.code));
      const atSubmission = expectedCodes(validUntil, T, moment, floor, spendable).filter(
        (code) => code === 'request.expired' || code === 'request.moment-skew',
      );

      expect(pick(result.errors)).toEqual(helper.errors);
      expect(pick(result.warnings)).toEqual(helper.warnings);
      expect(shared([...result.errors, ...result.warnings].map((finding) => finding.code))).toEqual(atSubmission);
    }));
  }, TIMEOUT);
});
