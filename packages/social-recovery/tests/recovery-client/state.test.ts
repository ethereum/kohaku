import { describe, expect, it } from 'vitest';
import { inferRemovedKey, type Address, type Attempt, type BlockHeader, type Hex, type KitNotification, type LogPosition, type RawTransaction } from '../../src/index';
import {
  ACCOUNT,
  ACCOUNT_FILTER,
  ACTION,
  attemptIn,
  callsTo,
  CLIENT_CONFIGURATION,
  DESCRIPTOR,
  HEADER,
  INJECTED,
  KEY_NEW,
  KEY_OLD,
  KEY_OTHER,
  lastArg,
  METHOD_ECDSA,
  METHOD_PASSKEY,
  PAYEE,
  pinnedOf,
  rig,
  stateFor,
  TOKEN,
  world,
  ZERO,
  type World,
} from './doubles';
import { payloadOf } from './encodings';
import { membersOf } from './prepare-fixtures';

const position = (block: number, index = 0): LogPosition => ({
  blockNumber: block,
  blockHash: `0x${block.toString(16).padStart(64, 'b')}`,
  logIndex: index,
  transactionHash: `0x${(block * 1000 + index).toString(16).padStart(64, 'c')}`,
  removed: false,
});

const started = (attemptId: bigint, payload: Hex, block: number): KitNotification => ({
  kind: 'attempt-started',
  account: ACCOUNT,
  action: ACTION,
  attemptId,
  setupNonce: 1n,
  setupBody: '0x',
  usedPlaces: [],
  usedMethods: [],
  payload,
  order: { token: ZERO, amount: 0n, payee: ZERO },
  consumableAfter: 0,
  at: position(block),
});

const consumed = (attemptId: bigint, block: number): KitNotification => ({ kind: 'attempt-consumed', account: ACCOUNT, action: ACTION, attemptId, at: position(block) });

const committedAt = (block: number): KitNotification => ({
  kind: 'setup-committed',
  account: ACCOUNT,
  action: ACTION,
  nonce: 1n,
  setupCommitment: `0x${'00'.repeat(32)}`,
  publicMetadata: '0x',
  privateMetadata: '0x',
  at: position(block),
});

const COMMIT = position(150);
const RAW: RawTransaction = { hash: COMMIT.transactionHash, from: KEY_OTHER, to: ACCOUNT, input: '0x', blockNumber: 150, blockHash: COMMIT.blockHash };

/** The removed key the exported inference answers over the same world, no address supplied. */
async function referenceKey(given: World): Promise<unknown> {
  const { parts, events, codec } = rig(given);

  return inferRemovedKey(
    {
      events,
      action: parts.action,
      codec,
      provider: parts.provider,
      ...(parts.signerRecovery === undefined ? {} : { signerRecovery: parts.signerRecovery }),
      descriptor: DESCRIPTOR,
      account: ACCOUNT,
      actionAddress: ACTION,
    },
    pinnedOf(given.header),
  );
}

const WAITING = attemptIn('Waiting', 4n);
const CANCELLED = attemptIn('Cancelled', 3n);
const NONE: Attempt = {
  attemptId: 0n,
  setupNonce: 0n,
  consumableAfter: 0,
  state: 'None',
  payloadHash: `0x${'00'.repeat(32)}`,
  order: { token: ZERO, amount: 0n, payee: ZERO },
  usedMethods: [],
  ignoresPause: false,
};

describe.each([
  ['a waiting attempt', WAITING],
  ['a cancelled attempt', CANCELLED],
  ['no attempt', NONE],
] as const)('recoveryState over %s', (_name, attempt) => {
  it('copies the stored attempt field for field and the record members as read', async () => {
    const state = stateFor(undefined, attempt);
    const built = rig(world({ state }));
    const record = await built.client.recoveryState();

    expect(record.attempt).toEqual(attempt);
    expect(Object.keys(record.attempt).sort()).toEqual(
      ['attemptId', 'setupNonce', 'consumableAfter', 'state', 'payloadHash', 'order', 'usedMethods', 'ignoresPause'].sort(),
    );
    expect(record.nextAttemptId).toBe(state.nextAttemptId);
    expect(record.setupCommitment).toBe(state.setupCommitment.toLowerCase());
    expect(record.setupNonce).toBe(state.setupNonce);
    expect(record.block).toEqual(HEADER);
  });

  it('pins one block with the read tag, reads the state at it and reads no pause', async () => {
    const built = rig(world({ state: stateFor(undefined, attempt) }));

    await built.client.recoveryState();

    expect(callsTo(built.seen, 'provider', 'block').map((one) => one.args)).toEqual([[CLIENT_CONFIGURATION.blockTags.read]]);
    expect(callsTo(built.seen, 'manager', 'stateOf')).toHaveLength(1);
    expect(lastArg(callsTo(built.seen, 'manager', 'stateOf')[0]!)).toEqual(pinnedOf(HEADER));
    expect(callsTo(built.seen, 'manager', 'paused')).toEqual([]);
    expect(callsTo(built.seen, 'manager', 'trustedParties')).toEqual([]);
    expect(membersOf(built.seen).filter((member) => member.startsWith('manager.prepare'))).toEqual([]);
  });
});

describe('recoveryState: the setup commitment', () => {
  it('comes back lower-cased', async () => {
    const state = { ...stateFor(), setupCommitment: `0x${'AB'.repeat(32)}` as Hex };
    const record = await rig(world({ state })).client.recoveryState();

    expect(record.setupCommitment).toBe(`0x${'ab'.repeat(32)}`);
  });
});

describe('recoveryState: the removed key', () => {
  const PREVIOUS = [started(2n, payloadOf(KEY_OLD, KEY_OTHER), 200), consumed(2n, 201)];
  const transactionHash = position(150).transactionHash;

  it.each<[string, Partial<World>, unknown]>([
    ['step 1: the latest consumed handover new key', { notifications: PREVIOUS }, KEY_OLD],
    [
      'step 2: the setup signer through the seam',
      { notifications: [committedAt(150)], transactions: new Map([[transactionHash.toLowerCase(), RAW]]), signer: { value: KEY_OLD } },
      KEY_OLD,
    ],
    ['no-source without the seam and without a handover', { notifications: [committedAt(150)] }, 'no-source'],
    ['not-a-key where isAuthority denies the named key', { notifications: PREVIOUS, authorities: new Set() }, 'not-a-key'],
    ['unread where the fetch fails', { failures: new Map([['events.fetch', INJECTED]]) }, 'unread'],
  ])('answers %s', async (_name, overrides, expected) => {
    const given = world(overrides);
    const record = await rig(given).client.recoveryState();

    expect(record.removedKey).toBe(expected);
    expect(record.removedKey).toEqual(await referenceKey(given));
  });

  it('reads the account history once from the deployment block to the pinned block', async () => {
    const built = rig(world({ notifications: PREVIOUS }));

    await built.client.recoveryState();

    const fetches = callsTo(built.seen, 'events', 'fetch');

    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.args[0]).toBe(ACCOUNT_FILTER);
    expect(fetches[0]?.args[1]).toEqual({ from: DESCRIPTOR.deployedAt, to: HEADER.number });
    expect(callsTo(built.seen, 'action', 'isAuthority').every((one) => JSON.stringify(lastArg(one)) === JSON.stringify(pinnedOf(HEADER)))).toBe(true);
  });

  it('supplies no address: a key isAuthority confirms is never asked first', async () => {
    const built = rig(world({ notifications: PREVIOUS }));

    await built.client.recoveryState();

    expect(callsTo(built.seen, 'action', 'isAuthority').map((one) => String(one.args[0]).toLowerCase())).not.toContain(KEY_NEW.toLowerCase());
  });
});

describe('recoveryState: failures', () => {
  it('rejects with a failing state read itself', async () => {
    await expect(rig(world({ failures: new Map([['manager.stateOf', INJECTED]]) })).client.recoveryState()).rejects.toBe(INJECTED);
  });

  it('rejects with a failing block read itself', async () => {
    await expect(rig(world({ failures: new Map([['provider.block', INJECTED]]) })).client.recoveryState()).rejects.toBe(INJECTED);
  });

  it('works under the version escape', async () => {
    await expect(rig(world(), CLIENT_CONFIGURATION, { escaped: true }).client.recoveryState()).resolves.toBeDefined();
  });
});

describe('recoveryState: the checked record', () => {
  it('copies a respelled stored attempt into a fresh record, hash lower-cased and addresses checksummed', async () => {
    const stored: Attempt = {
      ...WAITING,
      payloadHash: `0x${'AB'.repeat(32)}`,
      order: { token: TOKEN.toLowerCase() as Address, amount: 9n, payee: PAYEE.toLowerCase() as Address },
      usedMethods: [METHOD_ECDSA.toLowerCase() as Address, METHOD_PASSKEY.toLowerCase() as Address],
    };
    const state = stateFor(undefined, stored);
    const record = await rig(world({ state })).client.recoveryState();

    expect(record.attempt).toEqual({
      ...stored,
      payloadHash: `0x${'ab'.repeat(32)}`,
      order: { token: TOKEN, amount: 9n, payee: PAYEE },
      usedMethods: [METHOD_ECDSA, METHOD_PASSKEY],
    });
    expect(record.attempt).not.toBe(stored);
    expect(record.attempt.order).not.toBe(stored.order);
    expect(record.attempt.usedMethods).not.toBe(stored.usedMethods);
  });
});

describe('recoveryState: the record carries the eight attempt fields only', () => {
  it('drops a member the manager answers beyond the eight', async () => {
    const stored = { ...WAITING, extra: 'carried' } as Attempt;
    const record = await rig(world({ state: stateFor(undefined, stored) })).client.recoveryState();

    expect(Object.keys(record.attempt).sort()).toEqual(
      ['attemptId', 'setupNonce', 'consumableAfter', 'state', 'payloadHash', 'order', 'usedMethods', 'ignoresPause'].sort(),
    );
  });
});

describe('recoveryState: one pin for the state and the inference', () => {
  const PREVIOUS = [started(2n, payloadOf(KEY_OLD, KEY_OTHER), 200), consumed(2n, 201)];
  const LATER: BlockHeader = { number: HEADER.number + 5, timestamp: HEADER.timestamp + 60, hash: `0x${'6b'.repeat(32)}` };

  it('reads the state and every inference read at the one pinned block, even where a second pin would differ', async () => {
    const built = rig(world({ notifications: PREVIOUS, headers: [HEADER, LATER] }));
    const record = await built.client.recoveryState();
    const pinned = pinnedOf(HEADER);

    expect(record.block).toEqual(HEADER);
    expect(callsTo(built.seen, 'provider', 'block')).toHaveLength(1);
    expect(lastArg(callsTo(built.seen, 'manager', 'stateOf')[0]!)).toEqual(pinned);

    const authorities = callsTo(built.seen, 'action', 'isAuthority');

    expect(authorities.length).toBeGreaterThan(0);

    for (const one of authorities) expect(lastArg(one)).toEqual(pinned);

    expect(callsTo(built.seen, 'events', 'fetch').map((one) => (one.args[1] as { to: number }).to)).toEqual([HEADER.number]);
  });

  it.each([
    ['the state read answers last', 'manager.stateOf'],
    ['the inference answers last', 'events.fetch'],
  ])('answers the same record where %s', async (_name, slow) => {
    const plain = await rig(world({ notifications: PREVIOUS })).client.recoveryState();
    const reordered = await rig(world({ notifications: PREVIOUS, delays: new Map([[slow, 20]]) })).client.recoveryState();

    expect(reordered).toEqual(plain);
    expect(reordered.removedKey).toBe(KEY_OLD);
  });

  it('starts the inference without waiting for the state read', async () => {
    const built = rig(world({ notifications: PREVIOUS, delays: new Map([['manager.stateOf', 20]]), failures: new Map([['manager.stateOf', INJECTED]]) }));

    await expect(built.client.recoveryState()).rejects.toBe(INJECTED);
    expect(callsTo(built.seen, 'events', 'fetch')).toHaveLength(1);
  });

  it('reads the state without waiting for the inference', async () => {
    const built = rig(world({ notifications: PREVIOUS, delays: new Map([['events.fetch', 1_000]]), failures: new Map([['manager.stateOf', INJECTED]]) }));
    const startedAt = performance.now();

    await expect(built.client.recoveryState()).rejects.toBe(INJECTED);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
