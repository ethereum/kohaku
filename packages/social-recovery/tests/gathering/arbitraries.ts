import fc from 'fast-check';
import { fileReply, type Gathering, type GatheringPlace } from '../../src/index';
import { approvalGathering, bodyOver, cancellationGathering, methodAt, placeEntry, replyFor } from './support';

/** One rule case: clauses over flat places, each place's standing, and a filing order over some places. */
export type RuleCase = {
  readonly clauses: readonly { threshold: number; places: number[] }[];
  readonly places: readonly GatheringPlace[];
  readonly filed: readonly number[];
  readonly purpose: 'approval' | 'cancellation';
  readonly ignoresPause: boolean;
};

const shape = fc.array(fc.nat(4), { maxLength: 4 });

/** A rule of up to four clauses of up to four places, standings over up to three methods, and a filing order. */
export const ruleCase: fc.Arbitrary<RuleCase> = shape.chain((sizes) => {
  const total = sizes.reduce((a, b) => a + b, 0);
  let next = 0;
  const clausePlaces = sizes.map((size) => Array.from({ length: size }, () => next++));

  return fc.record({
    thresholds: fc.tuple(...sizes.map((size) => fc.nat(size + 1))),
    methods: fc.array(fc.record({ stopped: fc.boolean(), stoppable: fc.boolean() }), { minLength: 3, maxLength: 3 }),
    methodOf: fc.array(fc.nat(2), { minLength: total, maxLength: total }),
    filed: fc.shuffledSubarray(Array.from({ length: total }, (_v, i) => i)),
    purpose: fc.constantFrom('approval' as const, 'cancellation' as const),
    ignoresPause: fc.boolean(),
  }).map(({ thresholds, methods, methodOf, filed, purpose, ignoresPause }) => ({
    clauses: clausePlaces.map((places, i) => ({ threshold: Math.min(thresholds[i] ?? 0, 255), places })),
    places: methodOf.map((m, place) => {
      const { stopped, stoppable } = methods[m]!;

      return placeEntry(place, { method: methodAt(m), standing: stopped ? 'stopped' : 'not-stopped', stoppable: stoppable || stopped });
    }),
    filed,
    purpose,
    ignoresPause,
  }));
});

/** The gathering of a rule case with its replies filed in order. */
export function gatheringOf(c: RuleCase): Gathering {
  const body = bodyOver(c.clauses, c.places, c.ignoresPause);
  const start = c.purpose === 'approval' ? approvalGathering(c.places, body) : cancellationGathering(c.places, body);

  return c.filed.reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place));

    if (result.outcome !== 'filed') throw new Error(`refused at ${place}`);

    return result.gathering;
  }, start);
}
