import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/index';
import { TIMEOUT } from '../formats/arbitraries';
import { always } from './double';
import { METHOD, TRUE_WORD, partFor } from './fixtures';
import { runAsync } from './runs';

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

/** Arbitrary return bytes, biased toward the true word and its near misses. */
const returns: fc.Arbitrary<Hex> = fc.oneof(
  fc.uint8Array({ maxLength: 96 }).map(toHex),
  fc.uint8Array({ minLength: 32, maxLength: 32 }).map(toHex),
  fc.constant(TRUE_WORD),
  fc.tuple(fc.uint8Array({ maxLength: 40 }), fc.uint8Array({ maxLength: 40 })).map(([before, after]) => `0x${Buffer.from(before).toString('hex')}${TRUE_WORD.slice(2)}${Buffer.from(after).toString('hex')}` as Hex),
);

describe('paused(module) over arbitrary returns', () => {
  it('is stopped exactly when the module returned the true word, and always answered', async () => {
    await runAsync(
      fc.asyncProperty(returns, fc.boolean(), async (returned, upper) => {
        const spelled = upper ? (`0x${returned.slice(2).toUpperCase()}` as Hex) : returned;

        expect(await partFor(always({ returns: spelled })).paused(METHOD)).toEqual({ answered: true, value: returned === TRUE_WORD });
      }),
    );
  }, TIMEOUT);

  it('is answered and not stopped for any revert data', async () => {
    await runAsync(
      fc.asyncProperty(returns, async (data) => {
        expect(await partFor(always({ reverts: data })).paused(METHOD)).toEqual({ answered: true, value: false });
      }),
    );
  }, TIMEOUT);
});
