import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Gathering } from '../../src/index';
import { gatheringOf, ruleCase } from '../gathering/arbitraries';
import { PINNED_AT, ruleHolds, VALID_UNTIL } from '../gathering/support';
import { expectedMembers, loweredMembers, loweredProof, proofOfReply } from './completion-fixtures';
import { errorCodes, rig, runAsync, TIMEOUT } from './doubles';

const moment = fc.integer({ min: PINNED_AT - 2_000, max: VALID_UNTIL + 2_000 });

const outcome = (run: () => unknown): { value?: unknown; thrown?: unknown } => {
  try {
    return { value: run() };
  } catch (thrown) {
    return { thrown };
  }
};

const filedPlaces = (record: Gathering): number[] => record.replies.map((reply) => reply.place);

describe('complete over arbitrary rules, filings and moments', () => {
  it('refuses a passed window or an unmet rule, else partitions the filed places into chosen proofs and the rest', async () => {
    await runAsync(
      fc.asyncProperty(ruleCase, moment, async (c, now) => {
        const record = gatheringOf(c);
        const before = structuredClone(record);
        const { value, thrown } = outcome(() => rig().client.complete(record, undefined, now));
        const filed = filedPlaces(record);

        expect(record).toEqual(before);

        if (now > VALID_UNTIL) {
          expect(thrown).toBeInstanceOf(KitRefusalError);
          expect(errorCodes(thrown)).toContain('request.expired');

          return;
        }

        if (!ruleHolds(record.request.setupBody, filed)) {
          expect(thrown).toBeInstanceOf(KitRefusalError);
          expect(errorCodes(thrown)).toContain('request.rule-unsatisfied');

          return;
        }

        expect(thrown).toBeUndefined();

        const request = value as { proofs: { place: number }[] } & Parameters<typeof loweredMembers>[0];
        const chosen = request.proofs.map((proof) => proof.place);
        const omitted = filed.filter((place) => !chosen.includes(place));

        expect(chosen).toEqual([...chosen].sort((a, b) => a - b));
        expect(new Set(chosen).size).toBe(chosen.length);
        expect([...chosen, ...omitted].sort((a, b) => a - b)).toEqual([...filed].sort((a, b) => a - b));
        expect(ruleHolds(record.request.setupBody, chosen)).toBe(true);
        expect(loweredMembers(request)).toEqual(expectedMembers(record));

        for (const proof of request.proofs) {
          const reply = record.replies.find((one) => one.place === proof.place);

          expect(reply && proofOfReply(reply)).toEqual(loweredProof(proof as never));
        }
      }),
    );
  }, TIMEOUT);
});
