import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PreparedCall } from '../../src/index';
import { header } from './prepare-arbitraries';
import { CLIENT_CONFIGURATION, pinnedOf, rig, runAsync, stateFor, TIMEOUT, world, type Rig } from './doubles';
import { boundAttempt, boundCancel, liveAttempt } from './prepare-fixtures';

const PREPARES: readonly [string, (client: Rig['client'], now: number) => Promise<PreparedCall>][] = [
  ['prepareStartAttempt', (client, now) => client.prepareStartAttempt(boundAttempt(), now)],
  ['prepareCancelByProofs', (client, now) => client.prepareCancelByProofs(boundCancel(), now)],
];

describe.each(PREPARES)('%s over arbitrary pinned blocks', (_name, run) => {
  it('reads the block once and names it in every part call, the simulation and the prepared call', async () => {
    await runAsync(
      fc.asyncProperty(header, async (pinned) => {
        const built = rig(world({ header: pinned, state: stateFor(undefined, liveAttempt()) }), { ...CLIENT_CONFIGURATION, simulate: true });
        const prepared = await run(built.client, pinned.timestamp);

        expect(built.seen.filter((one) => one.part === 'provider' && one.member === 'block')).toHaveLength(1);
        expect(prepared.block).toEqual(pinnedOf(pinned));

        for (const one of built.seen.filter((entry) => entry.part === 'manager' || entry.part === 'action')) {
          expect(one.args[one.args.length - 1]).toEqual(pinnedOf(pinned));
        }

        for (const one of built.seen.filter((entry) => entry.part === 'provider' && entry.member === 'call')) {
          expect(one.args[3]).toBe(pinned.number);
        }
      }),
    );
  }, TIMEOUT);
});
