import { describe, expect, it } from 'vitest';
import { count, fileReply, type Finding, type Gathering, type RequestWindowBounds } from '../../src/index';
import { readVector } from '../kat/read-vector';
import {
  approvalGathering,
  bodyOver,
  cancellationGathering,
  FLOOR,
  PINNED_AT,
  placeEntry,
  readFixture,
  replyFor,
  ruleHolds,
  TWO_CLAUSES_BODY,
} from './support';

const BOUNDS: RequestWindowBounds = { default: 86_400, floor: FLOOR };
const NOW = PINNED_AT + 60;

/** A record with replies filed at the given places, in the given order. */
function withReplies(record: Gathering, places: readonly number[]): Gathering {
  return places.reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place));

    if (result.outcome !== 'filed') throw new Error(`refused at ${place}: ${result.reason.cause}`);

    return result.gathering;
  }, record);
}

/** Every subset of the given places. */
const subsets = (places: readonly number[]): number[][] =>
  places.reduce<number[][]>((acc, p) => acc.concat(acc.map((s) => [...s, p])), [[]]);

/** Every ordering of the given places. */
const permutations = (places: readonly number[]): number[][] =>
  places.length <= 1 ? [[...places]] : places.flatMap((p, i) => permutations(places.filter((_q, j) => j !== i)).map((rest) => [p, ...rest]));

const placesOf = (n: number) => Array.from({ length: n }, (_v, i) => placeEntry(i));

describe('count against the blessed setup-body rows', () => {
  const rows = readVector('setup-body.json').vectors;

  it('reads the three blessed rows', () => {
    expect(rows.map((r) => r['id'])).toStrictEqual(['two-clauses', 'empty-clauses', 'maximum-widths']);
  });

  it.each(subsets([0, 1, 2, 3]).map((s) => [s.join(',') || 'none', s] as const))(
    'two-clauses with places {%s} filled matches the rule written out',
    (_label, filled) => {
      const assessment = count(withReplies(approvalGathering(), filled), NOW, BOUNDS);
      const sorted = [...filled].sort((a, b) => a - b);

      expect(assessment.ruleSatisfied).toBe(ruleHolds(TWO_CLAUSES_BODY, filled));
      expect(assessment.filled).toStrictEqual(sorted);
      expect(assessment.missing).toStrictEqual([0, 1, 2, 3].filter((p) => !filled.includes(p)));
      expect(assessment.clauses).toStrictEqual([
        { clause: 0, threshold: 1, filled: sorted.filter((p) => p === 0).length },
        { clause: 1, threshold: 2, filled: sorted.filter((p) => p > 0).length },
      ]);
    },
  );

  it('two-clauses is satisfied by exactly the four sets holding place 0 and two of places 1..3', () => {
    const satisfying = subsets([0, 1, 2, 3]).filter((s) => count(withReplies(approvalGathering(), s), NOW, BOUNDS).ruleSatisfied);

    expect(satisfying.map((s) => s.join(','))).toStrictEqual(['0,1,2', '0,1,3', '0,2,3', '0,1,2,3']);
  });

  it('empty-clauses satisfies nothing', () => {
    const body = (rows[1]!.expected as { encoded: `0x${string}` }).encoded;
    const assessment = count(approvalGathering([], body), NOW, BOUNDS);

    expect(assessment).toMatchObject({ filled: [], missing: [], clauses: [], ruleSatisfied: false });
  });

  it('maximum-widths, a threshold of 255 over no credentials, is unsatisfied', () => {
    const body = (rows[2]!.expected as { encoded: `0x${string}` }).encoded;
    const assessment = count(approvalGathering([], body), NOW, BOUNDS);

    expect(assessment.ruleSatisfied).toBe(false);
    expect(assessment.clauses).toStrictEqual([{ clause: 0, threshold: 255, filled: 0 }]);
  });
});

describe('count over a rule of two clauses filled in every order', () => {
  it.each(permutations([0, 1, 2, 3]).map((p) => [p.join(','), p] as const))('order %s', (_label, filing) => {
    let record: Gathering = approvalGathering();

    for (const [step, place] of filing.entries()) {
      record = withReplies(record, [place]);

      const sofar = filing.slice(0, step + 1);

      expect(count(record, NOW, BOUNDS).ruleSatisfied).toBe(ruleHolds(TWO_CLAUSES_BODY, sofar));
    }

    expect(count(record, NOW, BOUNDS).ruleSatisfied).toBe(true);
  });
});

describe('count on the shapes the manager refuses', () => {
  it('an all-zero rule is unsatisfied even with every place filled', () => {
    const places = placesOf(3);
    const body = bodyOver([{ threshold: 0, places: [0, 1] }, { threshold: 0, places: [2] }], places);
    const assessment = count(withReplies(approvalGathering(places, body), [0, 1, 2]), NOW, BOUNDS);

    expect(assessment.ruleSatisfied).toBe(false);
    expect(assessment.clauses).toStrictEqual([
      { clause: 0, threshold: 0, filled: 2 },
      { clause: 1, threshold: 0, filled: 1 },
    ]);
  });

  it('an all-zero rule with nothing filled is unsatisfied', () => {
    const places = placesOf(1);

    expect(count(approvalGathering(places, bodyOver([{ threshold: 0, places: [0] }], places)), NOW, BOUNDS).ruleSatisfied).toBe(false);
  });

  it('a single zero clause beside a met clause is satisfied', () => {
    const places = placesOf(2);
    const body = bodyOver([{ threshold: 0, places: [0] }, { threshold: 1, places: [1] }], places);

    expect(count(withReplies(approvalGathering(places, body), [1]), NOW, BOUNDS).ruleSatisfied).toBe(true);
    expect(count(approvalGathering(places, body), NOW, BOUNDS).ruleSatisfied).toBe(false);
  });

  it('a clause with an empty credential list and threshold zero beside a met clause is satisfied', () => {
    const places = placesOf(1);
    const body = bodyOver([{ threshold: 1, places: [0] }, { threshold: 0, places: [] }], places);

    expect(count(withReplies(approvalGathering(places, body), [0]), NOW, BOUNDS).ruleSatisfied).toBe(true);
  });

  it('a body with no clauses is unsatisfied on a cancellation too', () => {
    expect(count(cancellationGathering([], bodyOver([], [])), NOW, BOUNDS).ruleSatisfied).toBe(false);
  });
});

describe('count findings (tester-authored boundary rows)', () => {
  const fixture = readFixture('count-findings.json');

  /** A finding reduced to its code and values, for an order-free comparison. */
  const shape = (f: Finding) => ({ code: f.code, values: f.values });
  const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

  it.each(fixture.vectors.map((r) => [r['id'] as string, r] as const))('%s', (_name, row) => {
    const input = row.input as { purpose: string; validUntil: string; pinnedAt: string; now: number; floor: number; consumableAfter?: string };
    const base = input.purpose === 'approval' ? approvalGathering() : cancellationGathering(undefined, undefined, Number(input.consumableAfter));
    const record = {
      ...base,
      request: { ...base.request, validUntil: input.validUntil, block: { ...base.request.block, timestamp: input.pinnedAt } },
    } as Gathering;
    const findings = count(record, input.now, { ...BOUNDS, floor: input.floor }).findings;
    const expected = (row.expected as { findings: { code: string; values: Record<string, unknown> }[] }).findings;

    expect(findings.map(shape).sort(byCode)).toStrictEqual([...expected].sort(byCode));
    expect(findings.every((f) => f.subject === 'request')).toBe(true);
  });

  it('an approval gathering never raises cancel.window-late', () => {
    const findings = count(approvalGathering(), PINNED_AT, BOUNDS).findings;

    expect(findings.map((f) => f.code)).not.toContain('cancel.window-late');
  });

  it('findings do not depend on the replies', () => {
    const record = approvalGathering();
    const now = PINNED_AT + 5_000;

    expect(count(withReplies(record, [0, 1, 2]), now, BOUNDS).findings).toStrictEqual(count(record, now, BOUNDS).findings);
  });
});
