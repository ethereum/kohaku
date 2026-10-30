import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { count } from '../../src/index';
import { run, TIMEOUT } from '../formats/arbitraries';
import { gatheringOf, ruleCase } from './arbitraries';
import { FLOOR, PINNED_AT, ruleHolds } from './support';

const BOUNDS = { default: 86_400, floor: FLOOR };

describe('count', () => {
  it('agrees with an independent evaluation of the rule, clause by clause', () => {
    run(
      fc.property(ruleCase, (c) => {
        const record = gatheringOf(c);
        const assessment = count(record, PINNED_AT, BOUNDS);
        const filled = [...c.filed].sort((a, b) => a - b);
        const total = c.places.length;

        expect(assessment.ruleSatisfied).toBe(ruleHolds(record.request.setupBody, c.filed));
        expect(assessment.filled).toStrictEqual(filled);
        expect(assessment.missing).toStrictEqual(Array.from({ length: total }, (_v, i) => i).filter((p) => !c.filed.includes(p)));
        expect(assessment.clauses).toStrictEqual(
          c.clauses.map((clause, i) => ({
            clause: i,
            threshold: clause.threshold,
            filled: clause.places.filter((p) => c.filed.includes(p)).length,
          })),
        );
        expect(assessment.findings).toStrictEqual([]);
      }),
    );
  }, TIMEOUT);
});
