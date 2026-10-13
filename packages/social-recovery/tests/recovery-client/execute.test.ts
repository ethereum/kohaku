import { decodeFunctionData, getAddress, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, POLICY_MANAGER_TRUE_WORD, RECOVERY_ACTION_DISARMED_VALUE, type Attempt, type Hex, type PaymentOrder } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  callsTo,
  CLIENT_CONFIGURATION,
  errorCodes,
  HEADER,
  INJECTED,
  KEY_NEW,
  KEY_OLD,
  lastArg,
  MANAGER,
  METHOD_ECDSA,
  METHOD_PASSKEY,
  ORDER,
  PAYEE,
  pinnedOf,
  rejectionOf,
  rig,
  stateFor,
  TOKEN,
  world,
  ZERO,
  type World,
} from './doubles';
import { describedBatch, executeHandoverData, loweredCall, payloadOf, PIN_WRITES_ABI } from './encodings';
import { liveAttempt, membersOf, PAYLOAD } from './prepare-fixtures';

const SPONSOR = getAddress(`0x${'5b'.repeat(20)}`);

/** A world whose stored attempt is the one passed, with the given pause answers. */
const chainWith = (attempt: Attempt, overrides: Partial<World> = {}) => world({ state: stateFor(undefined, attempt), ...overrides });

const execute = (attempt: Attempt, overrides: Partial<World> = {}, payload: Hex = PAYLOAD, options?: Parameters<ReturnType<typeof rig>['client']['prepareExecuteHandover']>[2]) => {
  const built = rig(chainWith(attempt, overrides));

  return { ...built, run: built.client.prepareExecuteHandover(attempt, payload, options) };
};

const expectedBatch = (attempt: Attempt, caller?: typeof SPONSOR) =>
  describedBatch(MANAGER, ACCOUNT, ACTION, attempt.attemptId, PAYLOAD, { newAuthority: KEY_NEW, removedAuthority: KEY_OLD }, attempt.order, caller).map(loweredCall);

describe('prepareExecuteHandover: the call', () => {
  it('prepares executeHandover(account, payload) on the bound action, sent by anyone, value zero, at the pinned block', async () => {
    const { run } = execute(liveAttempt());
    const prepared = await run;

    expect(prepared.kind).toBe('call');
    expect(prepared.target.toLowerCase()).toBe(ACTION.toLowerCase());
    expect(prepared.sender).toBe('anyone');
    expect(prepared.value).toBe(0n);
    expect(prepared.data.toLowerCase()).toBe(executeHandoverData(ACCOUNT, PAYLOAD).toLowerCase());
    expect(prepared.block).toEqual(pinnedOf(HEADER));
  });

  it('pins one block, reads the state once and each used method once, at that block, and no balance', async () => {
    const built = execute(liveAttempt());

    await built.run;

    const made = membersOf(built.seen);

    expect(made.filter((member) => member === 'provider.block')).toHaveLength(1);
    expect(callsTo(built.seen, 'manager', 'stateOf')).toHaveLength(1);
    expect(callsTo(built.seen, 'manager', 'paused').map((one) => String(one.args[0]).toLowerCase()).sort()).toEqual(
      [METHOD_ECDSA, METHOD_PASSKEY].map((m) => m.toLowerCase()).sort(),
    );

    for (const one of built.seen.filter((entry) => entry.part === 'manager')) expect(lastArg(one)).toEqual(pinnedOf(HEADER));

    expect(made.filter((member) => member === 'provider.call')).toEqual([]);
    expect(made.filter((member) => member.startsWith('action.'))).toEqual([]);
  });

  it('reads each distinct used method once', async () => {
    const built = execute(liveAttempt(ORDER, [METHOD_ECDSA, METHOD_ECDSA.toLowerCase() as typeof METHOD_ECDSA]));

    await built.run;
    expect(callsTo(built.seen, 'manager', 'paused')).toHaveLength(1);
  });

  it('reads no pause where the attempt ignores it', async () => {
    const attempt = liveAttempt(ORDER, [METHOD_ECDSA], true);
    const built = execute(attempt, { paused: new Map([[METHOD_ECDSA.toLowerCase(), { answered: true, value: true }]]) });

    await expect(built.run).resolves.toBeDefined();
    expect(callsTo(built.seen, 'manager', 'paused')).toEqual([]);
  });
});

describe('prepareExecuteHandover: the described batch', () => {
  it('describes consume, grant, revoke and an ERC-20 transfer to the order payee', async () => {
    const attempt = liveAttempt();
    const prepared = await execute(attempt).run;

    expect(prepared.describes?.map(loweredCall)).toEqual(expectedBatch(attempt));
    expect(prepared.describes).toHaveLength(4);
  });

  it('describes three calls and no payment for a zero amount', async () => {
    const attempt = liveAttempt({ token: TOKEN, amount: 0n, payee: PAYEE });
    const prepared = await execute(attempt).run;

    expect(prepared.describes?.map(loweredCall)).toEqual(expectedBatch(attempt));
    expect(prepared.describes).toHaveLength(3);
  });

  it('describes the native payment as a value call to the payee with no data', async () => {
    const attempt = liveAttempt({ token: ZERO, amount: 7n, payee: PAYEE });
    const prepared = await execute(attempt).run;
    const payment = prepared.describes?.[3];

    expect(payment && loweredCall(payment)).toEqual({ target: PAYEE.toLowerCase(), value: 7n, data: '0x' });
  });

  it.each([
    ['an ERC-20', TOKEN],
    ['the native token', ZERO],
  ] as const)('pays options.from on an open payee in %s', async (_name, token) => {
    const attempt = liveAttempt({ token, amount: 9n, payee: ZERO });
    const prepared = await execute(attempt, {}, PAYLOAD, { from: SPONSOR }).run;

    expect(prepared.describes?.map(loweredCall)).toEqual(expectedBatch(attempt, SPONSOR));
  });

  it('builds the open-payee, zero-amount execute with no from: three calls', async () => {
    const attempt = liveAttempt({ token: ZERO, amount: 0n, payee: ZERO });
    const prepared = await execute(attempt).run;

    expect(prepared.describes).toHaveLength(3);
  });

  it('keeps a fixed payee whatever from is given', async () => {
    const attempt = liveAttempt();
    const prepared = await execute(attempt, {}, PAYLOAD, { from: SPONSOR }).run;

    expect(prepared.describes?.map(loweredCall)).toEqual(expectedBatch(attempt));
  });

  it('simulates from options.from, else the zero address', async () => {
    const attempt = liveAttempt();
    const withFrom = execute(attempt, {}, PAYLOAD, { simulate: true, from: SPONSOR });

    await withFrom.run;
    expect(String(callsTo(withFrom.seen, 'provider', 'call')[0]?.args[2]).toLowerCase()).toBe(SPONSOR.toLowerCase());

    const without = execute(attempt, {}, PAYLOAD, { simulate: true });

    await without.run;
    expect(String(callsTo(without.seen, 'provider', 'call')[0]?.args[2]).toLowerCase()).toBe(ZERO);
  });
});

describe('prepareExecuteHandover: argument refusals before any read', () => {
  it.each([
    ['an ERC-20', TOKEN],
    ['the native token', ZERO],
  ] as const)('an open payee with a nonzero amount in %s and no from is a TypeError', async (_name, token) => {
    const built = execute(liveAttempt({ token, amount: 1n, payee: ZERO }));
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it.each([
    ['no attempt', () => undefined],
    ['a number attempt id', (a: Attempt) => ({ ...a, attemptId: 4 })],
    ['an unknown state', (a: Attempt) => ({ ...a, state: 'Live' })],
    ['a short payload hash', (a: Attempt) => ({ ...a, payloadHash: '0x77' })],
    ['an order without an amount', (a: Attempt) => ({ ...a, order: { token: TOKEN, payee: PAYEE } })],
    ['used methods that are not an array', (a: Attempt) => ({ ...a, usedMethods: METHOD_ECDSA })],
  ] as const)('refuses %s with a TypeError or RangeError', async (_name, change) => {
    const attempt = liveAttempt();
    const built = rig(chainWith(attempt));
    const thrown = await rejectionOf(built.client.prepareExecuteHandover(change(attempt) as unknown as Attempt, PAYLOAD));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it.each([
    ['not hex', '0xzz'],
    ['a number', 7],
    ['odd-length hex', '0xabc'],
  ] as const)('refuses a payload that is %s with a TypeError or RangeError', async (_name, payload) => {
    const built = execute(liveAttempt(), {}, payload as unknown as Hex);
    const thrown = await rejectionOf(built.run);

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });
});

describe('prepareExecuteHandover: refusals', () => {
  it('refuses a payload whose hash is not the attempt payload hash, with a KitRefusalError', async () => {
    const other = payloadOf(KEY_OLD, KEY_NEW);
    const built = execute(liveAttempt(), {}, other);
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
  });

  it.each([
    ['does not decode', '0xabcdef' as Hex],
    ['names a zero new key', payloadOf(ZERO, KEY_OLD)],
    ['names a zero removed key', payloadOf(KEY_NEW, ZERO)],
    ['names one key twice', payloadOf(KEY_NEW, KEY_NEW)],
  ])('refuses a payload that %s with handover.malformed', async (_name, payload) => {
    const attempt = { ...liveAttempt(), payloadHash: keccak256(payload) };
    const built = execute(attempt, {}, payload);
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toContain('handover.malformed');
  });

  it.each([
    ['attempt id', (a: Attempt): Attempt => ({ ...a, attemptId: a.attemptId + 1n })],
    ['payload hash', (a: Attempt): Attempt => ({ ...a, payloadHash: `0x${'78'.repeat(32)}` })],
    ['order amount', (a: Attempt): Attempt => ({ ...a, order: { ...a.order, amount: a.order.amount + 1n } })],
    ['order payee', (a: Attempt): Attempt => ({ ...a, order: { ...a.order, payee: SPONSOR } })],
    ['order token', (a: Attempt): Attempt => ({ ...a, order: { ...a.order, token: ZERO } })],
  ])('refuses an attempt whose %s differs from the stored one', async (_name, change) => {
    const stored = liveAttempt();
    const built = rig(chainWith(stored));
    const thrown = await rejectionOf(built.client.prepareExecuteHandover(change(stored), PAYLOAD, { from: SPONSOR }));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
  });

  it('accepts the stored order spelled in other case', async () => {
    const stored = liveAttempt();
    const passed: Attempt = { ...stored, order: { ...stored.order, token: TOKEN.toLowerCase() as PaymentOrder['token'] } };

    await expect(rig(chainWith(stored)).client.prepareExecuteHandover(passed, PAYLOAD)).resolves.toBeDefined();
  });

  it('accepts the stored payload hash passed in upper-case hex', async () => {
    const stored = liveAttempt();
    const passed: Attempt = { ...stored, payloadHash: `0x${stored.payloadHash.slice(2).toUpperCase()}` };

    await expect(rig(chainWith(stored)).client.prepareExecuteHandover(passed, PAYLOAD)).resolves.toBeDefined();
  });

  it('refuses where a used method is stopped, naming the method', async () => {
    const built = execute(liveAttempt(), { paused: new Map([[METHOD_PASSKEY.toLowerCase(), { answered: true, value: true }]]) });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as Error).message.toLowerCase()).toContain(METHOD_PASSKEY.toLowerCase());
    expect((thrown as KitRefusalError).findings).toBeUndefined();
  });

  it('prepares over a stopped used method when the attempt ignores the pause', async () => {
    const attempt = liveAttempt(ORDER, [METHOD_PASSKEY], true);
    const built = execute(attempt, { paused: new Map([[METHOD_PASSKEY.toLowerCase(), { answered: true, value: true }]]) });

    await expect(built.run).resolves.toBeDefined();
  });

  it('rejects an unanswered pause read with a plain Error, not a refusal', async () => {
    const built = execute(liveAttempt(), { paused: new Map([[METHOD_ECDSA.toLowerCase(), { answered: false }]]) });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(KitRefusalError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  it('rejects with a failing state read itself', async () => {
    const built = execute(liveAttempt(), { failures: new Map([['manager.stateOf', INJECTED]]) });

    await expect(built.run).rejects.toBe(INJECTED);
  });

  it('runs on the simulating configuration with the default from', async () => {
    const attempt = liveAttempt();
    const built = rig(chainWith(attempt), { ...CLIENT_CONFIGURATION, simulate: true });
    const prepared = await built.client.prepareExecuteHandover(attempt, PAYLOAD);

    expect(prepared.simulation).toEqual({ success: true });
  });
});

describe('prepareExecuteHandover: the privilege words', () => {
  it('grants the new key the manager\'s true word and revokes the removed key with the disarmed value', async () => {
    const prepared = await execute(liveAttempt()).run;
    const [, grant, revoke] = prepared.describes ?? [];
    const priv = (data: Hex | undefined) => decodeFunctionData({ abi: PIN_WRITES_ABI, data: data ?? '0x' }).args?.[1];

    expect(priv(grant?.data)).toBe(POLICY_MANAGER_TRUE_WORD);
    expect(priv(revoke?.data)).toBe(RECOVERY_ACTION_DISARMED_VALUE);
  });
});

describe('prepareExecuteHandover: the read log', () => {
  const METHOD_THIRD = getAddress(`0x${'e9'.repeat(20)}`);

  it.each<[string, readonly typeof METHOD_ECDSA[], boolean, number]>([
    ['two methods', [METHOD_ECDSA, METHOD_PASSKEY], false, 2],
    ['one method', [METHOD_ECDSA], false, 1],
    [
      'repeats in other case across three methods',
      [METHOD_ECDSA, METHOD_PASSKEY, METHOD_ECDSA.toLowerCase() as typeof METHOD_ECDSA, METHOD_THIRD, METHOD_PASSKEY],
      false,
      3,
    ],
    ['two methods under ignoresPause', [METHOD_ECDSA, METHOD_PASSKEY], true, 0],
    ['no method', [], false, 0],
  ])('reads the pin, the state and paused once per distinct used method over %s, and no trusted parties', async (_name, methods, ignoresPause, pauses) => {
    const built = execute(liveAttempt(ORDER, methods, ignoresPause));

    await built.run;

    const made = membersOf(built.seen);

    expect(made.slice(0, 2)).toEqual(['provider.block', 'manager.stateOf']);
    expect(made.slice(2)).toEqual(Array.from({ length: pauses }, () => 'manager.paused'));
    expect(new Set(callsTo(built.seen, 'manager', 'paused').map((one) => String(one.args[0]).toLowerCase())).size).toBe(pauses);
    expect(callsTo(built.seen, 'manager', 'trustedParties')).toEqual([]);
  });
});
