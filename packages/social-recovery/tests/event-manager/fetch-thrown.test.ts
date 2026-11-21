import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawLog } from '../../src/index';
import { ACCOUNT, ACTION, eventLog, makeReader, MANAGER, providerDouble, ZERO } from './fixture';

/** What the mocked cancel derivation throws while armed. */
const decoder = vi.hoisted(() => ({ armed: false, thrown: undefined as unknown }));

vi.mock('../../src/event-manager/cancelled-by', async (original) => {
  const actual = await original<typeof import('../../src/event-manager/cancelled-by')>();

  return {
    ...actual,
    deriveCancelledBy: (...args: Parameters<typeof actual.deriveCancelledBy>) => {
      if (decoder.armed) throw decoder.thrown;

      return actual.deriveCancelledBy(...args);
    },
  };
});

afterEach(() => {
  decoder.armed = false;
  decoder.thrown = undefined;
});

/** A well-formed owner cancel from the manager, decoded through the cancel derivation. */
const cancelledAt = (logIndex: number): RawLog =>
  eventLog(
    MANAGER,
    'AttemptCancelled',
    { account: ACCOUNT, action: ACTION, attemptId: 3n, canceller: ACCOUNT, vetoingMethod: ZERO, setupNonce: 2n, usedPlaces: [] },
    { blockNumber: 4, logIndex },
  );

/** A well-formed `AttemptConsumed` from the manager, which no cancel derivation reads. */
const consumedAt = (logIndex: number): RawLog =>
  eventLog(MANAGER, 'AttemptConsumed', { account: ACCOUNT, action: ACTION, attemptId: 3n }, { blockNumber: 4, logIndex });

describe('fetch: the value a decoder throws is the skipped entry\'s error, whatever it is', () => {
  it.each([
    ['an Error', new Error('decoder failed')],
    ['a RangeError', new RangeError('out of range')],
    ['a string', 'decoder failed'],
    ['a plain object', { reason: 'decoder failed' }],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
  ])('%s', async (_label, value) => {
    decoder.armed = true;
    decoder.thrown = value;

    const malformed = cancelledAt(1);
    const reader = makeReader(providerDouble(async () => [consumedAt(0), malformed]), 100);
    const { notifications, skipped } = await reader.fetch(reader.accountFilter(), { from: 0, to: 9 });
    const fromDecodeLog = (() => {
      try {
        reader.decodeLog(malformed);
      } catch (error: unknown) {
        return { error };
      }

      return undefined;
    })();

    expect(notifications.map((entry) => entry.kind)).toEqual(['attempt-consumed']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.log).toBe(malformed);
    expect(skipped[0]?.error).toBe(value);
    expect(fromDecodeLog).toBeDefined();
    expect(fromDecodeLog?.error).toBe(value);
  });

  it('the same log decodes once the derivation answers again', async () => {
    const reader = makeReader(providerDouble(async () => [cancelledAt(1)]), 100);
    const { notifications, skipped } = await reader.fetch(reader.accountFilter(), { from: 0, to: 9 });

    expect(notifications.map((entry) => entry.kind === 'attempt-cancelled' && entry.cancelledBy)).toEqual(['cancelByOwner']);
    expect(skipped).toEqual([]);
  });
});
