import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attempt, header, uint, word32 } from './prepare-arbitraries';
import { callsTo, lastArg, pinnedOf, rig, runAsync, TIMEOUT, world } from './doubles';

describe('recoveryState over arbitrary stored states', () => {
  it('copies the stored attempt and record members at the one pinned block', async () => {
    await runAsync(
      fc.asyncProperty(attempt, header, uint(64), uint(64), word32, async (stored, pinned, nextAttemptId, setupNonce, setupCommitment) => {
        const state = { setupCommitment, setupNonce, nextAttemptId, setupCommittedAtBlock: 1, attempt: stored };
        const built = rig(world({ header: pinned, state }));
        const record = await built.client.recoveryState();

        expect(record.attempt).toEqual(stored);
        expect(record.nextAttemptId).toBe(nextAttemptId);
        expect(record.setupNonce).toBe(setupNonce);
        expect(record.setupCommitment).toBe(setupCommitment.toLowerCase());
        expect(record.block).toEqual(pinned);
        expect(callsTo(built.seen, 'provider', 'block')).toHaveLength(1);
        expect(callsTo(built.seen, 'manager', 'paused')).toEqual([]);

        for (const one of built.seen.filter((entry) => entry.part === 'manager' || entry.part === 'action')) {
          expect(lastArg(one)).toEqual(pinnedOf(pinned));
        }
      }),
    );
  }, TIMEOUT);
});
