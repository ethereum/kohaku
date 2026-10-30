import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Address } from '../../src/index';
import { CONFIGURATION, errorCodes, KEY_NEW, KEY_OLD, KEY_OTHER, ORDER, rejectionOf, rig, runAsync, TIMEOUT, world, ZERO } from './doubles';

const KEYS = [KEY_OLD, KEY_NEW, KEY_OTHER, ZERO] as const;

/** A key from the pool in one of the spellings the address rule accepts. */
const spelled = fc
  .tuple(fc.constantFrom(...KEYS), fc.constantFrom('checksummed', 'lower', 'upper'))
  .map(([key, spelling]): Address => {
    if (spelling === 'lower') return key.toLowerCase() as Address;

    if (spelling === 'upper') return `0x${key.slice(2).toUpperCase()}`;

    return key;
  });

const subset = fc.subarray([...KEYS]).map((keys) => new Set(keys.map((key) => key.toLowerCase())));

describe('the opening init over arbitrary handover pairs', () => {
  it(
    'refuses exactly the zero, same, not-a-key and already-privileged pairs, and otherwise encodes the pair',
    async () => {
      await runAsync(
        fc.asyncProperty(spelled, spelled, subset, subset, async (newAuthority, removedAuthority, authorities, privileged) => {
          const built = rig(world({ authorities, privileged }));
          const run = built.client.initRecoveryGathering(CONFIGURATION, { newAuthority, removedAuthority }, ORDER, { window: 3_600 });
          const newKey = newAuthority.toLowerCase();
          const removedKey = removedAuthority.toLowerCase();
          const zero = ZERO.toLowerCase();
          const refused =
            newKey === zero || removedKey === zero || newKey === removedKey || !authorities.has(removedKey) || privileged.has(newKey);

          if (refused) {
            const thrown = await rejectionOf(run);

            expect(thrown).toBeInstanceOf(KitRefusalError);
            expect(errorCodes(thrown).length).toBeGreaterThan(0);
            expect(errorCodes(thrown).every((code) => code.startsWith('handover.'))).toBe(true);

            if (newKey === zero || removedKey === zero || newKey === removedKey) expect(built.codec.encoded).toEqual([]);

            return;
          }

          const record = await run;

          if (record.purpose !== 'approval') throw new Error('approval expected');

          expect(built.codec.decode(record.request.payload)).toEqual({
            newAuthority: getAddress(newAuthority),
            removedAuthority: getAddress(removedAuthority),
          });
        }),
      );
    },
    TIMEOUT,
  );
});
