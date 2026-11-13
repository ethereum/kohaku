import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/index';
import { actionManagerAt } from '../../src/recovery-action/manager-read';
import { address, TIMEOUT } from '../formats/arbitraries';
import { ACTION, selectorOf, word } from './fixtures';
import { providerDouble } from './provider-double';

const RUNS = {
  numRuns: Number(process.env['FC_NUM_RUNS'] ?? 256),
  ...(process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) }),
};

const MANAGER_SELECTOR = selectorOf('MANAGER()');

/** The read's answer where the action returns the given bytes. */
const answerTo = (returns: Hex) => actionManagerAt(providerDouble({ [MANAGER_SELECTOR]: { returns } }).provider, ACTION, 'latest');

const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('the MANAGER() answer for any bytes', () => {
  it(
    'a clean word answers the address it holds, checksummed',
    async () => {
      await fc.assert(
        fc.asyncProperty(address, async (manager) => {
          expect(await answerTo(`0x${word(manager)}`)).toEqual({ answered: true, value: getAddress(manager) });
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    'a word whose top twelve bytes are not all zero answers nothing',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 12, maxLength: 12 }).filter((top) => top.some((byte) => byte !== 0)),
          address,
          async (top, manager) => {
            expect(await answerTo(`0x${hexOf(top)}${manager.slice(2)}`)).toEqual({ answered: false });
          },
        ),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    'a clean word followed by any further bytes answers nothing',
    async () => {
      await fc.assert(
        fc.asyncProperty(address, fc.uint8Array({ minLength: 1, maxLength: 64 }), async (manager, trailing) => {
          expect(await answerTo(`0x${word(manager)}${hexOf(trailing)}`)).toEqual({ answered: false });
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    'fewer than 32 bytes answer nothing',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.uint8Array({ maxLength: 31 }), async (bytes) => {
          expect(await answerTo(`0x${hexOf(bytes)}`)).toEqual({ answered: false });
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );
});
