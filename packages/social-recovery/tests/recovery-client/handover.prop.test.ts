import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Address } from '../../src/index';
import { oracleKitSlot } from '../formats/request-support';
import {
  ACCOUNT,
  ACTION,
  CONFIGURATION,
  errorCodes,
  KEY_NEW,
  KEY_OLD,
  KEY_OTHER,
  MANAGER,
  ORDER,
  rejectionOf,
  rig,
  runAsync,
  TIMEOUT,
  world,
  ZERO,
} from './doubles';

const FALLBACK_HANDLER: Address = '0x0000000000000000000000000000000000006969';

/** The destination name a new key nobody can sign for is reported under, by its lower-cased address. */
const RESERVED: ReadonlyMap<string, string> = new Map([
  [ACCOUNT.toLowerCase(), 'account'],
  [MANAGER.toLowerCase(), 'manager'],
  [ACTION.toLowerCase(), 'action'],
  [oracleKitSlot(ACTION).toLowerCase(), 'kit-slot'],
  [FALLBACK_HANDLER, 'fallback-handler'],
]);

const KEYS = [KEY_OLD, KEY_NEW, KEY_OTHER, ZERO, ACCOUNT, MANAGER, ACTION, oracleKitSlot(ACTION), FALLBACK_HANDLER] as const;

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
    'refuses exactly the zero, same, not-a-key, already-privileged and reserved pairs, naming the destination, and otherwise encodes the pair',
    async () => {
      await runAsync(
        fc.asyncProperty(spelled, spelled, subset, subset, async (newAuthority, removedAuthority, authorities, privileged) => {
          const built = rig(world({ authorities, privileged }));
          const run = built.client.initRecoveryGathering(CONFIGURATION, { newAuthority, removedAuthority }, ORDER, { window: 3_600 });
          const newKey = newAuthority.toLowerCase();
          const removedKey = removedAuthority.toLowerCase();
          const zero = ZERO.toLowerCase();
          const reserved = RESERVED.get(newKey);
          const refused =
            newKey === zero || removedKey === zero || newKey === removedKey || !authorities.has(removedKey) || privileged.has(newKey) ||
            reserved !== undefined;

          if (refused) {
            const thrown = await rejectionOf(run);

            expect(thrown).toBeInstanceOf(KitRefusalError);
            expect(errorCodes(thrown).length).toBeGreaterThan(0);
            expect(errorCodes(thrown).every((code) => code.startsWith('handover.'))).toBe(true);
            expect(
              (thrown as KitRefusalError).findings?.errors.filter((finding) => finding.code === 'handover.new-reserved').map((finding) => finding.values['reserved']),
            ).toEqual(reserved === undefined ? [] : [reserved]);

            if (newKey === zero || removedKey === zero || newKey === removedKey || reserved !== undefined) expect(built.codec.encoded).toEqual([]);

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
