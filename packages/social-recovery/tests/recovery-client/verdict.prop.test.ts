import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATHERING_ORDER_REFUSAL_MESSAGES,
  GATHERING_SELECTION_UNFILLED_MESSAGE,
  type Gathering,
  KitRefusalError,
  order,
  orderVerdict,
  submissionFindings,
} from '../../src/index';
import { windowFactsOf } from '../../src/gathering/edge';
import { gatheringOf, ruleCase } from '../gathering/arbitraries';
import { PINNED_AT, placeEntry, replyFor, ruleHolds, VALID_UNTIL } from '../gathering/support';
import { rig, runAsync, TIMEOUT } from './doubles';

const moment = fc.integer({ min: PINNED_AT - 2_000, max: VALID_UNTIL + 2_000 });

/**
 * A rule case, a moment, whether a hand-built reply fills the place just past the body's count (in the place map, which
 * `fileReply` never files), and no selection or any subset of the body's places and that place, filled or not, in any order.
 */
const scenario = ruleCase.chain((c) =>
  fc.tuple(
    fc.constant(c),
    moment,
    fc.boolean(),
    fc.option(fc.shuffledSubarray([...c.places.map((p) => p.place), c.places.length]), { nil: undefined }),
  ),
);

/** The rule case's gathering, with a reply at the place past the count where `past` says so. */
function recordOf(c: Parameters<typeof gatheringOf>[0], past: boolean): Gathering {
  const base = gatheringOf(c);

  if (!past) return base;

  const widened = { ...base, places: [...base.places, placeEntry(c.places.length)] } as Gathering;

  return { ...widened, replies: [...widened.replies, replyFor(widened, c.places.length)] } as Gathering;
}

const outcome = (run: () => unknown): { value?: unknown; thrown?: unknown } => {
  try {
    return { value: run() };
  } catch (thrown) {
    return { thrown };
  }
};

describe('order and complete both read the ordering verdict', () => {
  it('refuse exactly where the verdict refuses, with its message and findings, else give its proofs', async () => {
    const { client } = rig();

    await runAsync(
      fc.asyncProperty(scenario, async ([c, now, past, selection]) => {
        const record = recordOf(c, past);
        const before = structuredClone(record);
        const verdict = outcome(() => orderVerdict(record, selection, now));
        const ordered = outcome(() => order(record, selection, now));
        const completed = outcome(() => client.complete(record, selection, now));
        const filed = record.replies.map((reply) => reply.place);
        const judged = selection ?? filed;

        expect(record).toEqual(before);
        expect(verdict.thrown === undefined || verdict.thrown instanceof RangeError).toBe(true);

        if (now > VALID_UNTIL) {
          expect(verdict.value).toStrictEqual({
            outcome: 'refused',
            reason: 'window-passed',
            findings: submissionFindings(windowFactsOf(record), now),
          });
        } else if (judged.some((place) => !filed.includes(place))) {
          expect(verdict.thrown).toBeInstanceOf(RangeError);
          expect((verdict.thrown as Error).message).toBe(GATHERING_SELECTION_UNFILLED_MESSAGE);
        } else if (judged.includes(c.places.length)) {
          expect(verdict.value).toMatchObject({ outcome: 'refused', reason: 'place-out-of-range' });
          expect(verdict.value).toHaveProperty('findings.warnings', []);
          expect((verdict.value as { findings: { errors: unknown[] } }).findings.errors).toContainEqual({
            code: 'proof.place-out-of-range',
            subject: 'request',
            values: { place: c.places.length, count: c.places.length },
          });
        } else if (!ruleHolds(record.request.setupBody, judged)) {
          expect(verdict.value).toMatchObject({ outcome: 'refused', reason: 'rule-unsatisfied' });
          expect(verdict.value).toHaveProperty('findings.warnings', []);
          expect((verdict.value as { findings: { errors: { code: string }[] } }).findings.errors.length).toBeGreaterThan(0);
          expect((verdict.value as { findings: { errors: { code: string }[] } }).findings.errors.every((e) => e.code === 'request.rule-unsatisfied')).toBe(true);
        } else {
          expect(verdict.value).toMatchObject({ outcome: 'ordered' });
        }

        if (verdict.thrown !== undefined) {
          for (const other of [ordered.thrown, completed.thrown]) {
            expect(other).toBeInstanceOf(RangeError);
            expect(other).not.toBeInstanceOf(KitRefusalError);
            expect((other as Error).message).toBe((verdict.thrown as Error).message);
          }

          return;
        }

        const v = verdict.value as ReturnType<typeof orderVerdict>;

        if (v.outcome === 'refused') {
          const message = GATHERING_ORDER_REFUSAL_MESSAGES[v.reason];

          expect(ordered.thrown).toBeInstanceOf(RangeError);
          expect((ordered.thrown as Error).message).toBe(message);
          expect(completed.thrown).toBeInstanceOf(KitRefusalError);
          expect((completed.thrown as KitRefusalError).message).toBe(message);
          expect((completed.thrown as KitRefusalError).findings).toStrictEqual(v.findings);
          expect(Object.hasOwn(completed.thrown as object, 'cause')).toBe(false);

          return;
        }

        expect(ordered.thrown).toBeUndefined();
        expect(completed.thrown).toBeUndefined();
        expect(ordered.value).toStrictEqual(v.proofs);
        expect((completed.value as { proofs: unknown }).proofs).toStrictEqual(v.proofs);
        expect((completed.value as { proofs: unknown }).proofs).toStrictEqual(ordered.value);
      }),
    );
  }, TIMEOUT);
});
