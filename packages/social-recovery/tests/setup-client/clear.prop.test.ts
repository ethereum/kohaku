import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hex, PreparedBatch, PreparedCall } from '../../src/index';
import { ACTION, build, clearSetupData, DISARMING_DATA, FC_PARAMS, standingState, TIMEOUT, ZERO_WORD } from './doubles';

const commitmentArbitrary: fc.Arbitrary<Hex> = fc.oneof(
  fc.constant(ZERO_WORD),
  fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes): Hex => `0x${Buffer.from(bytes).toString('hex')}`),
);

describe('prepareClearSetup properties', () => {
  it(
    'takes its shape from whether a setup stands and whether the account authorizes, and clears under the stored nonce',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          commitmentArbitrary,
          fc.bigInt({ min: 0n, max: 2n ** 64n - 2n }),
          fc.nat({ max: 1_000_000 }),
          fc.boolean(),
          fc.boolean(),
          async (commitment, nonce, atBlock, authorized, simulate) => {
            const { client } = build({ world: { state: standingState(commitment, nonce, atBlock), authorized } });
            const prepared = await client.prepareClearSetup({ simulate });
            const stands = commitment !== ZERO_WORD;

            if (stands && authorized) {
              expect(prepared.kind).toBe('batch');
              expect((prepared as PreparedBatch).atomic).toBe(true);
              expect((prepared as PreparedBatch).calls.map((call) => call.data).sort()).toEqual([clearSetupData(ACTION, nonce), DISARMING_DATA].sort());
            } else {
              expect(prepared.kind).toBe('call');
              expect((prepared as PreparedCall).data).toBe(stands ? clearSetupData(ACTION, nonce) : DISARMING_DATA);
            }
          },
        ),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );
});
