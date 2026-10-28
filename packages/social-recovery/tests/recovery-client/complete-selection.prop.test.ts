import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gatheringOf, ruleCase } from '../gathering/arbitraries';
import { PINNED_AT, ruleHolds } from '../gathering/support';
import { rig, runAsync, TIMEOUT } from './doubles';

const outcome = (run: () => unknown): { value?: unknown; thrown?: unknown } => {
  try {
    return { value: run() };
  } catch (thrown) {
    return { thrown };
  }
};

describe('complete over arbitrary selections of filed places', () => {
  it('honours any satisfying selection of filed places exactly', async () => {
    await runAsync(
      fc.asyncProperty(
        ruleCase.chain((c) => fc.tuple(fc.constant(c), fc.subarray([...c.filed]))),
        async ([c, selection]) => {
          const record = gatheringOf(c);
          const { value, thrown } = outcome(() => rig().client.complete(record, selection, PINNED_AT));

          if (!ruleHolds(record.request.setupBody, selection)) {
            expect(thrown).toBeInstanceOf(Error);

            return;
          }

          expect((value as { proofs: { place: number }[] }).proofs.map((proof) => proof.place)).toEqual([...selection].sort((a, b) => a - b));
        },
      ),
    );
  }, TIMEOUT);
});
