import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attempt, cancelRequest, header } from './prepare-arbitraries';
import { CLIENT_CONFIGURATION, pinnedOf, rig, runAsync, stateFor, TIMEOUT, world } from './doubles';
import { cancelByProofsData } from './encodings';
import { membersOf } from './prepare-fixtures';

const moment = fc.integer({ min: 0, max: 2 ** 40 });

describe('the cancel submission over arbitrary requests, states and moments', () => {
  it('prepareCancelByProofs never judges the request and encodes the pinned cancelByProofs bytes', async () => {
    await runAsync(
      fc.asyncProperty(cancelRequest, attempt, header, moment, async (request, stored, pinned, now) => {
        const built = rig(world({ header: pinned, state: stateFor(undefined, stored) }), { ...CLIENT_CONFIGURATION, simulate: true });
        const prepared = await built.client.prepareCancelByProofs(request, now);

        expect(prepared.data.toLowerCase()).toBe(cancelByProofsData(request).toLowerCase());
        expect(prepared.sender).toBe('anyone');
        expect(prepared.block).toEqual(pinnedOf(pinned));
        expect(membersOf(built.seen)).toEqual(['provider.block', 'manager.prepareCancelByProofs', 'provider.call']);
      }),
    );
  }, TIMEOUT);
});
