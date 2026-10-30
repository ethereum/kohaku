import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attempt, attemptRequest, header } from './prepare-arbitraries';
import { CLIENT_CONFIGURATION, MANAGER, pinnedOf, rig, runAsync, stateFor, TIMEOUT, world } from './doubles';
import { startAttemptData } from './encodings';
import { membersOf } from './prepare-fixtures';

const moment = fc.integer({ min: 0, max: 2 ** 40 });

describe('the submission prepares over arbitrary requests, states and moments', () => {
  it('prepareStartAttempt never judges the request and encodes the pinned startAttempt bytes', async () => {
    await runAsync(
      fc.asyncProperty(attemptRequest, attempt, header, moment, async (request, stored, pinned, now) => {
        const built = rig(world({ header: pinned, state: stateFor(undefined, stored) }), { ...CLIENT_CONFIGURATION, simulate: true });
        const prepared = await built.client.prepareStartAttempt(request, now);

        expect(prepared.data.toLowerCase()).toBe(startAttemptData(request).toLowerCase());
        expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
        expect(prepared.sender).toBe('anyone');
        expect(prepared.value).toBe(0n);
        expect(prepared.block).toEqual(pinnedOf(pinned));
        expect(membersOf(built.seen)).toEqual(['provider.block', 'manager.prepareStartAttempt', 'provider.call']);
      }),
    );
  }, TIMEOUT);
});
