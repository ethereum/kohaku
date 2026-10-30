import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hex, PreparedCall } from '../../src/index';
import { TIMEOUT, bytesN, safeInt } from '../formats/arbitraries';
import { partFor } from './fixtures';
import { MEMBERS, answeringAll } from './members';
import { runAsync } from './runs';

/** A valid block: any safe number, its hash in either case. */
const block = fc.record({
  number: fc.oneof(fc.constantFrom(0, Number.MAX_SAFE_INTEGER), safeInt(0, Number.MAX_SAFE_INTEGER)),
  hash: bytesN(32),
  upper: fc.boolean(),
});

describe('a passed block over arbitrary blocks and members', () => {
  it('never reads a block, calls only at the passed number, and a prepare reports the block lower-cased', async () => {
    await runAsync(
      fc.asyncProperty(block, fc.constantFrom(...MEMBERS), async ({ number, hash, upper }, entry) => {
        const provider = answeringAll();
        const spelled = (upper ? `0x${hash.slice(2).toUpperCase()}` : hash) as Hex;
        const result = await entry.invoke(partFor(provider), [{ number, hash: spelled }]);

        expect(provider.blockTags).toEqual([]);
        expect(provider.calls).toHaveLength(entry.calls);
        expect(provider.calls.every((call) => call.block === number)).toBe(true);

        if (entry.prepare) expect((result as PreparedCall).block).toEqual({ number, hash: hash.toLowerCase() });
      }),
    );
  }, TIMEOUT);
});
