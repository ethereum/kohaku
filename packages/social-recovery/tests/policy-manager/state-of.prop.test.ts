import fc from 'fast-check';
import { encodeAbiParameters, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATES, type Address } from '../../src/index';
import { TIMEOUT, address, bytesN, safeInt, uint } from '../formats/arbitraries';
import { always } from './double';
import { ACTION_STATE_PARAMS, partFor } from './fixtures';
import { runAsync } from './runs';

const UINT48_MAX = 2 ** 48 - 1;

const rawState = fc.record({
  setupCommitment: bytesN(32),
  setupNonce: uint(64),
  nextAttemptId: uint(64),
  setupCommittedAtBlock: safeInt(0, UINT48_MAX),
  attempt: fc.record({
    attemptId: uint(64),
    setupNonce: uint(64),
    consumableAfter: safeInt(0, UINT48_MAX),
    state: fc.integer({ min: 0, max: 3 }),
    ignoresPause: fc.boolean(),
    payloadHash: bytesN(32),
    order: fc.record({ token: address, amount: uint(256), payee: address }),
    usedMethods: fc.array(address, { maxLength: 4 }),
  }),
});

const checksummed = (value: string): Address => getAddress(value);

describe('stateOf() over arbitrary states', () => {
  it('decodes exactly the ActionState the contract encoded', async () => {
    await runAsync(
      fc.asyncProperty(rawState, async (raw) => {
        const state = await partFor(always({ returns: encodeAbiParameters(ACTION_STATE_PARAMS, [raw]) })).stateOf();

        expect(state).toEqual({
          ...raw,
          attempt: {
            ...raw.attempt,
            state: ATTEMPT_STATES[raw.attempt.state],
            order: { token: checksummed(raw.attempt.order.token), amount: raw.attempt.order.amount, payee: checksummed(raw.attempt.order.payee) },
            usedMethods: raw.attempt.usedMethods.map(checksummed),
          },
        });
      }),
    );
  }, TIMEOUT);

  it('throws a TypeError for every attempt state the enum does not declare', async () => {
    await runAsync(
      fc.asyncProperty(rawState, fc.integer({ min: 4, max: 255 }), async (raw, state) => {
        const returned = encodeAbiParameters(ACTION_STATE_PARAMS, [{ ...raw, attempt: { ...raw.attempt, state } }]);

        await expect(partFor(always({ returns: returned })).stateOf()).rejects.toThrow(TypeError);
      }),
    );
  }, TIMEOUT);
});
