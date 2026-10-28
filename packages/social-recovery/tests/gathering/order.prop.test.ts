import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { order } from '../../src/index';
import { run, TIMEOUT } from '../formats/arbitraries';
import { gatheringOf, ruleCase, type RuleCase } from './arbitraries';
import { PINNED_AT, ruleHolds } from './support';

/** Whether some subset of the filed places avoiding stopped methods satisfies the rule, by per-clause counting. */
const stopFreeSetExists = (c: RuleCase): boolean =>
  c.clauses.every(
    (clause) => clause.places.filter((p) => c.filed.includes(p) && c.places[p]!.standing !== 'stopped').length >= clause.threshold,
  );

/** The four criteria as a sort key: stopped present, size, distinct stoppable methods, ascending filing positions. */
function rank(c: RuleCase, set: readonly number[]): number[] {
  const stopped = !c.ignoresPause && set.some((p) => c.places[p]!.standing === 'stopped') ? 1 : 0;
  const stoppable = new Set(set.filter((p) => c.places[p]!.stoppable).map((p) => c.places[p]!.method)).size;
  const filedAt = set.map((p) => c.filed.indexOf(p)).sort((a, b) => a - b);

  return [stopped, set.length, stoppable, ...filedAt];
}

/** Whether one sort key orders strictly before another. */
function before(left: readonly number[], right: readonly number[]): boolean {
  const at = left.findIndex((k, i) => k !== right[i]);

  return at !== -1 && left[at]! < right[at]!;
}

/** The best satisfying subset of the filed places by brute force over every subset. */
function bruteForce(c: RuleCase, body: `0x${string}`): number[] {
  let best: { set: number[]; key: number[] } | undefined;

  for (let mask = 0; mask < 1 << c.filed.length; mask++) {
    const set = c.filed.filter((_p, i) => (mask >> i) & 1);

    if (!ruleHolds(body, set)) continue;

    const key = rank(c, set);

    if (best === undefined || before(key, best.key)) best = { set, key };
  }

  return (best?.set ?? []).sort((a, b) => a - b);
}

describe('order', () => {
  it('chooses the set a brute-force ranking by the four criteria chooses', () => {
    run(
      fc.property(ruleCase.filter((c) => c.filed.length <= 10), (c) => {
        const record = gatheringOf(c);
        const body = record.request.setupBody;

        if (!ruleHolds(body, c.filed)) return;

        expect(order(record, undefined, PINNED_AT).map((p) => p.place)).toStrictEqual(bruteForce(c, body));
      }),
    );
  }, TIMEOUT);

  it('is strictly increasing, satisfies the rule, is minimal and avoids stops where it can; else refuses', () => {
    run(
      fc.property(ruleCase, (c) => {
        const record = gatheringOf(c);
        const body = record.request.setupBody;

        if (!ruleHolds(body, c.filed)) {
          expect(() => order(record, undefined, PINNED_AT)).toThrow();

          return;
        }

        const places = order(record, undefined, PINNED_AT).map((p) => p.place);

        expect(places.every((p, i) => i === 0 || p > places[i - 1]!)).toBe(true);
        expect(places.every((p) => c.filed.includes(p))).toBe(true);
        expect(ruleHolds(body, places)).toBe(true);
        expect(places).toHaveLength(c.clauses.reduce((sum, clause) => sum + clause.threshold, 0));

        if (!c.ignoresPause && stopFreeSetExists(c)) {
          expect(places.some((p) => c.places[p]!.standing === 'stopped')).toBe(false);
        }
      }),
    );
  }, TIMEOUT);
});
