import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateRequest, type AttemptRequest } from '../../src/index';
import { TIMEOUT, run } from '../formats/arbitraries';
import { oracleBody, oracleCommitment } from '../formats/support';
import { ACCOUNT, ACTION, OPENING, REQUEST_CONTEXT, STATE, config } from './fixtures';

/** A body of one to four clauses with thresholds within their counts and at least one above zero. */
const body = fc
  .array(
    fc.integer({ min: 1, max: 4 }).chain((count) =>
      fc.record({ count: fc.constant(count), threshold: fc.integer({ min: 0, max: count }) }),
    ),
    { minLength: 1, maxLength: 4 },
  )
  .filter((clauses) => clauses.some(({ threshold }) => threshold > 0));

/** Per clause, a subset of its places of at least its threshold, chosen by flags. */
const satisfying = body.chain((clauses) =>
  fc
    .tuple(...clauses.map(({ count }) => fc.array(fc.boolean(), { minLength: count, maxLength: count })))
    .map((flags) => ({ clauses, flags })),
);

/** Fills each clause's first `threshold` places, then any extra places the flags set. */
function filledPlaces(clauses: readonly { count: number; threshold: number }[], flags: readonly (readonly boolean[])[]): number[] {
  const places: number[] = [];
  let start = 0;

  clauses.forEach(({ count, threshold }, clause) => {
    for (let offset = 0; offset < count; offset += 1) {
      if (offset < threshold || flags[clause]![offset]) places.push(start + offset);
    }

    start += count;
  });

  return places;
}

/** The request over this body with one proof per place, and its context with the stored commitment matching. */
function requestFor(clauses: readonly { count: number; threshold: number }[], places: readonly number[]) {
  let n = 0;
  const setupBody = oracleBody({
    wait: 172_800,
    ignoresPause: false,
    clauses: clauses.map(({ count, threshold }) => ({ threshold, credentials: Array.from({ length: count }, () => config((n += 1))) })),
  });
  const request: AttemptRequest = {
    ...OPENING,
    setupBody,
    proofs: places.map((place) => ({ ...OPENING.proofs[0]!, place })),
  };
  const context = { ...REQUEST_CONTEXT, state: { ...STATE, setupCommitment: oracleCommitment(ACCOUNT, ACTION, 3n, setupBody) } };

  return validateRequest(request, context);
}

describe('request.rule-unsatisfied properties', () => {
  it('a satisfying proof array never yields request.rule-unsatisfied', () => {
    run(fc.property(satisfying, ({ clauses, flags }) => {
      const codes = requestFor(clauses, filledPlaces(clauses, flags)).errors.map((finding) => finding.code);

      expect(codes).not.toContain('request.rule-unsatisfied');
    }));
  }, TIMEOUT);

  it('dropping one required place of a clause names exactly that clause', () => {
    run(fc.property(body, fc.nat(), (clauses, pick) => {
      const required = clauses.map((clause, index) => ({ ...clause, index })).filter(({ threshold }) => threshold > 0);
      const victim = required[pick % required.length]!;
      const places = filledPlaces(clauses, clauses.map(({ count }) => Array<boolean>(count).fill(false)));
      const start = clauses.slice(0, victim.index).reduce((sum, { count }) => sum + count, 0);
      const fewer = places.filter((place) => place !== start);
      const unsatisfied = requestFor(clauses, fewer).errors.filter((finding) => finding.code === 'request.rule-unsatisfied');

      expect(unsatisfied.map((finding) => finding.values)).toEqual([
        { clause: victim.index, threshold: victim.threshold, filled: victim.threshold - 1 },
      ]);
    }));
  }, TIMEOUT);
});
