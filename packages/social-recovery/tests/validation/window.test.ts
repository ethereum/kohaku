import { describe, expect, it } from 'vitest';
import { VALIDATION_MOMENT_SKEW_SECONDS, submissionFindings, windowFindings, type RequestWindowBounds } from '../../src/index';

const T = 1_700_000_000;
const BOUNDS: RequestWindowBounds = { default: 86_400, floor: 3_600 };

const codes = (result: ReturnType<typeof windowFindings>): string[] =>
  [...result.errors, ...result.warnings].map((finding) => finding.code).sort();

describe('the shared window helper', () => {
  it('ships a moment skew span of fifteen minutes', () => {
    expect(VALIDATION_MOMENT_SKEW_SECONDS).toBe(900);
  });

  it('raises nothing on a default window read at the block time', () => {
    expect(windowFindings({ validUntil: T + 86_400, blockTimestamp: T }, T, BOUNDS)).toEqual({ errors: [], warnings: [] });
  });

  it('raises request.expired as an error once the moment is one second past validUntil', () => {
    const result = windowFindings({ validUntil: T + 4_000, blockTimestamp: T }, T + 4_001, BOUNDS);

    expect(result.errors).toEqual([
      { code: 'request.expired', subject: 'request', values: { validUntil: T + 4_000, moment: T + 4_001, blockTimestamp: T } },
    ]);
  });

  it('does not raise request.expired with the moment exactly at validUntil', () => {
    const result = windowFindings({ validUntil: T + 900, blockTimestamp: T + 100 }, T + 900, { ...BOUNDS, floor: 0 });

    expect(result.errors).toEqual([]);
  });

  it('raises request.window-short one second under the floor and not at it', () => {
    expect(windowFindings({ validUntil: T + 3_599, blockTimestamp: T }, T, BOUNDS).warnings).toEqual([
      { code: 'request.window-short', subject: 'request', values: { window: 3_599, floor: 3_600 } },
    ]);
    expect(windowFindings({ validUntil: T + 3_600, blockTimestamp: T }, T, BOUNDS).warnings).toEqual([]);
  });

  it('reads the floor from the bounds it is handed', () => {
    const raised = { ...BOUNDS, floor: 7_200 };

    expect(codes(windowFindings({ validUntil: T + 3_600, blockTimestamp: T }, T, raised))).toEqual(['request.window-short']);
  });

  it('raises request.moment-skew past 900 seconds either side of the block timestamp and not at 900', () => {
    const facts = { validUntil: T + 86_400, blockTimestamp: T };

    expect(windowFindings(facts, T + 901, BOUNDS).warnings).toEqual([
      { code: 'request.moment-skew', subject: 'request', values: { moment: T + 901, blockTimestamp: T, span: 900 } },
    ]);
    expect(codes(windowFindings(facts, T - 901, BOUNDS))).toEqual(['request.moment-skew']);
    expect(codes(windowFindings(facts, T + 900, BOUNDS))).toEqual([]);
    expect(codes(windowFindings(facts, T - 900, BOUNDS))).toEqual([]);
  });

  it('raises cancel.window-late when the cancel window ends one second after consumableAfter', () => {
    const facts = { validUntil: T + 43_200, blockTimestamp: T, consumableAfter: T + 43_199 };

    expect(windowFindings(facts, T, BOUNDS).warnings).toEqual([
      { code: 'cancel.window-late', subject: 'request', values: { validUntil: T + 43_200, consumableAfter: T + 43_199 } },
    ]);
  });

  it('does not raise cancel.window-late at consumableAfter or on an opening window', () => {
    expect(codes(windowFindings({ validUntil: T + 43_200, blockTimestamp: T, consumableAfter: T + 43_200 }, T, BOUNDS))).toEqual(
      [],
    );
    expect(codes(windowFindings({ validUntil: T + 43_200, blockTimestamp: T }, T, BOUNDS))).toEqual([]);
  });

  it('returns all four findings together', () => {
    const facts = { validUntil: T + 10, blockTimestamp: T, consumableAfter: T + 5 };

    expect(codes(windowFindings(facts, T + 1_000, BOUNDS))).toEqual([
      'cancel.window-late',
      'request.expired',
      'request.moment-skew',
      'request.window-short',
    ]);
  });

  it('throws a TypeError on a malformed argument rather than returning a finding', () => {
    expect(() => windowFindings(null as never, T, BOUNDS)).toThrow(TypeError);
    expect(() => windowFindings({ validUntil: T, blockTimestamp: T }, 'now' as never, BOUNDS)).toThrow(TypeError);
  });
});

describe('the submission window helper', () => {
  it('raises request.expired and request.moment-skew as the gathering helper does', () => {
    const facts = { validUntil: T + 4_000, blockTimestamp: T };

    expect(submissionFindings(facts, T + 4_001)).toEqual({
      errors: [{ code: 'request.expired', subject: 'request', values: { validUntil: T + 4_000, moment: T + 4_001, blockTimestamp: T } }],
      warnings: [{ code: 'request.moment-skew', subject: 'request', values: { moment: T + 4_001, blockTimestamp: T, span: 900 } }],
    });
    expect(submissionFindings(facts, T + 900)).toEqual({ errors: [], warnings: [] });
  });

  it('raises neither request.window-short nor cancel.window-late where the gathering helper raises both', () => {
    const facts = { validUntil: T + 10, blockTimestamp: T, consumableAfter: T + 5 };

    expect(codes(submissionFindings(facts, T))).toEqual([]);
    expect(codes(windowFindings(facts, T, BOUNDS))).toEqual(['cancel.window-late', 'request.window-short']);
  });

  it('throws a TypeError on a malformed argument rather than returning a finding', () => {
    expect(() => submissionFindings(undefined as never, T)).toThrow(TypeError);
    expect(() => submissionFindings({ validUntil: T, blockTimestamp: T }, null as never)).toThrow(TypeError);
  });
});
