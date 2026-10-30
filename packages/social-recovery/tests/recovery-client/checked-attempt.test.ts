import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Attempt } from '../../src/index';
import {
  callsTo,
  CLIENT_CONFIGURATION,
  CONFIGURATION,
  INJECTED,
  METHOD_ECDSA,
  METHOD_PASSKEY,
  PAYEE,
  rejectionOf,
  rig,
  stateFor,
  TOKEN,
  world,
  type World,
} from './doubles';
import { liveAttempt, membersOf, PAYLOAD } from './prepare-fixtures';

/** The attempt the caller passes: a small amount, so a number spelling of it is exact. */
const PASSED = liveAttempt({ token: TOKEN, amount: 5n, payee: PAYEE });

/** One malformed value per attempt field, the field's name, and whether only a width is wrong. */
const MALFORMED: readonly (readonly [string, RegExp, 'type' | 'width', (attempt: Attempt) => unknown])[] = [
  ['setupNonce as a number', /setupNonce/, 'type', (a) => ({ ...a, setupNonce: 3 })],
  ['setupNonce as a string', /setupNonce/, 'type', (a) => ({ ...a, setupNonce: '3' })],
  ['setupNonce over uint64', /setupNonce/, 'width', (a) => ({ ...a, setupNonce: 2n ** 64n })],
  ['a negative setupNonce', /setupNonce/, 'width', (a) => ({ ...a, setupNonce: -1n })],
  ['payloadHash one byte long', /payloadHash/, 'type', (a) => ({ ...a, payloadHash: '0x77' })],
  ['payloadHash not hex', /payloadHash/, 'type', (a) => ({ ...a, payloadHash: `0x${'zz'.repeat(32)}` })],
  ['payloadHash as a number', /payloadHash/, 'type', (a) => ({ ...a, payloadHash: 7 })],
  ['order.token short', /token/, 'type', (a) => ({ ...a, order: { ...a.order, token: TOKEN.slice(0, -2) } })],
  ['order.token missing', /token/, 'type', (a) => ({ ...a, order: { amount: a.order.amount, payee: a.order.payee } })],
  ['order.amount as a number', /amount/, 'type', (a) => ({ ...a, order: { ...a.order, amount: 5 } })],
  ['order.amount as a string', /amount/, 'type', (a) => ({ ...a, order: { ...a.order, amount: '5' } })],
  ['a negative order.amount', /amount/, 'width', (a) => ({ ...a, order: { ...a.order, amount: -5n } })],
  ['order.amount over uint256', /amount/, 'width', (a) => ({ ...a, order: { ...a.order, amount: 2n ** 256n } })],
  ['order.payee not an address', /payee/, 'type', (a) => ({ ...a, order: { ...a.order, payee: 'payee' } })],
  ['order.payee as a number', /payee/, 'type', (a) => ({ ...a, order: { ...a.order, payee: 0 } })],
  // eslint-disable-next-line no-sparse-arrays
  ['usedMethods with a hole', /usedMethods/, 'type', (a) => ({ ...a, usedMethods: [METHOD_ECDSA, , METHOD_PASSKEY] })],
  ['usedMethods with a short entry', /usedMethods/, 'type', (a) => ({ ...a, usedMethods: [METHOD_ECDSA, '0x12'] })],
  ['usedMethods as one address', /usedMethods/, 'type', (a) => ({ ...a, usedMethods: METHOD_ECDSA })],
  ['ignoresPause as the string false', /ignoresPause/, 'type', (a) => ({ ...a, ignoresPause: 'false' })],
  ['ignoresPause as zero', /ignoresPause/, 'type', (a) => ({ ...a, ignoresPause: 0 })],
];

/** A world whose manager answers the attempt with one field changed. */
const malformedWorld = (change: (attempt: Attempt) => unknown, overrides: Partial<World> = {}): World =>
  world({ state: stateFor(undefined, change(PASSED) as Attempt), ...overrides });

const expectNamedRefusal = (thrown: unknown, field: RegExp, kind: 'type' | 'width'): void => {
  if (kind === 'type') expect(thrown).toBeInstanceOf(TypeError);
  else expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);

  expect(thrown).not.toBeInstanceOf(KitRefusalError);
  expect((thrown as Error).message).toMatch(field);
};

describe('the attempt the manager answers, checked whole at the read', () => {
  it.each(MALFORMED)('recoveryState refuses %s with an error naming the field', async (_name, field, kind, change) => {
    const thrown = await rejectionOf(rig(malformedWorld(change)).client.recoveryState());

    expectNamedRefusal(thrown, field, kind);
  });

  it.each(MALFORMED)('prepareExecuteHandover refuses %s right after the state read, reading no pause', async (_name, field, kind, change) => {
    const built = rig(malformedWorld(change), { ...CLIENT_CONFIGURATION, simulate: true });
    const thrown = await rejectionOf(built.client.prepareExecuteHandover(PASSED, PAYLOAD));

    expectNamedRefusal(thrown, field, kind);
    expect(membersOf(built.seen)).toEqual(['provider.block', 'manager.stateOf']);
  });

  it.each(MALFORMED)('recoveryState refuses %s whichever read answers first', async (_name, field, kind, change) => {
    for (const slow of ['manager.stateOf', 'events.fetch']) {
      const thrown = await rejectionOf(rig(malformedWorld(change, { delays: new Map([[slow, 20]]) })).client.recoveryState());

      expectNamedRefusal(thrown, field, kind);
    }
  });

  it('accepts the stored attempt spelled in other case, preparing over it', async () => {
    const respelled: Attempt = {
      ...PASSED,
      payloadHash: PASSED.payloadHash.toUpperCase().replace('0X', '0x') as Attempt['payloadHash'],
      order: { token: TOKEN.toLowerCase() as Attempt['order']['token'], amount: 5n, payee: PAYEE.toLowerCase() as Attempt['order']['payee'] },
      usedMethods: PASSED.usedMethods.map((method) => method.toLowerCase() as Attempt['usedMethods'][number]),
    };
    const built = rig(world({ state: stateFor(undefined, respelled) }));

    await expect(built.client.prepareExecuteHandover(PASSED, PAYLOAD)).resolves.toBeDefined();
    await expect(built.client.recoveryState()).resolves.toBeDefined();
  });

  it('rejects a failing state read with the failure itself in both members', async () => {
    const failing = world({ state: stateFor(undefined, PASSED), failures: new Map([['manager.stateOf', INJECTED]]) });

    await expect(rig(failing).client.recoveryState()).rejects.toBe(INJECTED);
    await expect(rig(failing).client.prepareExecuteHandover(PASSED, PAYLOAD)).rejects.toBe(INJECTED);
  });
});

describe('the inits keep their own reading of the attempt', () => {
  it('initCancelGathering still opens over a waiting attempt whose stored payload hash is malformed', async () => {
    const built = rig(malformedWorld((a) => ({ ...a, payloadHash: '0x77' })));

    await expect(built.client.initCancelGathering(CONFIGURATION, { window: 3_600 })).resolves.toBeDefined();
    expect(callsTo(built.seen, 'manager', 'stateOf')).toHaveLength(1);
  });

  it('the same state refuses at recoveryState, so the difference is the members\', not the world\'s', async () => {
    const thrown = await rejectionOf(rig(malformedWorld((a) => ({ ...a, payloadHash: '0x77' }))).client.recoveryState());

    expect(thrown).toBeInstanceOf(TypeError);
  });
});
