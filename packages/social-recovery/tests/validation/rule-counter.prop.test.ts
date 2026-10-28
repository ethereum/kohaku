import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clausePlaces, filledPerClause, satisfies, validateRequest, type SetupBody } from '../../src/index';
import { TIMEOUT, run } from '../formats/arbitraries';
import { oracleBody, oracleCommitment } from '../formats/support';
import { ACCOUNT, ACTION, OPENING, REQUEST_CONTEXT, STATE, config } from './fixtures';

const body: fc.Arbitrary<SetupBody> = fc
  .array(fc.record({ threshold: fc.integer({ min: 0, max: 5 }), count: fc.integer({ min: 0, max: 4 }) }), { maxLength: 4 })
  .map((clauses) => {
    let n = 0;

    return {
      wait: 0,
      ignoresPause: false,
      clauses: clauses.map(({ threshold, count }) => ({ threshold, credentials: Array.from({ length: count }, () => config((n += 1))) })),
    };
  });

const places = fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 12 });

/** The clause a flat place falls in, by walking the credential counts, or -1 past the end. */
function clauseOf(rule: SetupBody, place: number): number {
  let remaining = place;

  for (let clause = 0; clause < rule.clauses.length; clause += 1) {
    const count = rule.clauses[clause]!.credentials.length;

    if (remaining < count) return clause;

    remaining -= count;
  }

  return -1;
}

/** The manager's predicate evaluated independently: no clauses or all zero fails, else every clause meets its threshold. */
function reference(rule: SetupBody, filled: readonly number[]): { perClause: number[]; satisfied: boolean } {
  const perClause = rule.clauses.map(() => 0);

  for (const place of new Set(filled)) {
    const clause = clauseOf(rule, place);

    if (clause >= 0) perClause[clause]! += 1;
  }

  const degenerate = rule.clauses.length === 0 || rule.clauses.every((clause) => clause.threshold === 0);

  return { perClause, satisfied: !degenerate && rule.clauses.every((clause, index) => perClause[index]! >= clause.threshold) };
}

describe('the shared rule counter properties', () => {
  it('clausePlaces numbers every credential once, in body order', () => {
    run(fc.property(body, (rule) => {
      const total = rule.clauses.reduce((sum, clause) => sum + clause.credentials.length, 0);

      expect(clausePlaces(rule).flat()).toEqual(Array.from({ length: total }, (_, place) => place));
      expect(clausePlaces(rule).map((own) => own.length)).toEqual(rule.clauses.map((clause) => clause.credentials.length));
    }));
  }, TIMEOUT);

  it('filledPerClause and satisfies agree with an independent evaluation', () => {
    run(fc.property(body, places, (rule, filled) => {
      const expected = reference(rule, filled);

      expect(filledPerClause(rule, filled)).toEqual(expected.perClause);
      expect(satisfies(rule, filled)).toBe(expected.satisfied);
    }));
  }, TIMEOUT);

  it('validateRequest raises request.rule-unsatisfied exactly when satisfies is false', () => {
    run(fc.property(body, places, (rule, filled) => {
      const setupBody = oracleBody(rule);
      const sortedPlaces = [...new Set(filled)].sort((left, right) => left - right);
      const request = { ...OPENING, setupBody, proofs: sortedPlaces.map((place) => ({ ...OPENING.proofs[0]!, place })) };
      const context = { ...REQUEST_CONTEXT, state: { ...STATE, setupCommitment: oracleCommitment(ACCOUNT, ACTION, 3n, setupBody) } };
      const codes = validateRequest(request, context).errors.map((finding) => finding.code);

      expect(codes.includes('request.rule-unsatisfied')).toBe(!satisfies(rule, sortedPlaces));
    }));
  }, TIMEOUT);
});
