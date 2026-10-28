import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hex, PinnedBlock, PreparedCall } from '../../src/index';
import { bytesN, safeInt, TIMEOUT } from '../formats/arbitraries';
import { ALL_ANSWERS, BLOCK_MEMBERS } from './block-members';
import { partOver } from './fixtures';
import { providerDouble } from './provider-double';

const RUNS = { numRuns: Number(process.env['FC_NUM_RUNS'] ?? 256) };

/** A valid pinned block, its hash in either case. */
const block = fc.record({
  number: fc.oneof(fc.constantFrom(0, Number.MAX_SAFE_INTEGER), safeInt(0, Number.MAX_SAFE_INTEGER)),
  hash: fc.tuple(bytesN(32), fc.boolean()).map(([hash, upper]): Hex => (upper ? `0x${hash.slice(2).toUpperCase()}` : hash)),
});

describe('any valid passed block', () => {
  it('pins every member to its number and never reads a block', async () => {
    await fc.assert(
      fc.asyncProperty(block, fc.constantFrom(...BLOCK_MEMBERS), async (pinned: PinnedBlock, member) => {
        const double = providerDouble(ALL_ANSWERS);
        const result = await member.invoke(partOver(double.provider), pinned);

        expect(double.blockTags).toEqual([]);
        expect(double.calls.every((seen) => seen.block === pinned.number)).toBe(true);

        if (member.prepare) {
          expect((result as PreparedCall).block).toStrictEqual({ number: pinned.number, hash: pinned.hash.toLowerCase() });
        }
      }),
      RUNS,
    );
  }, TIMEOUT);
});
