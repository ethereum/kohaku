import { encodeAbiParameters, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Address, type Handover, type KitNotification, type LogPosition } from '../../src/index';
import { oracleKitSlot } from '../formats/request-support';
import {
  ACCOUNT,
  ACTION,
  callsTo,
  CLIENT_CONFIGURATION,
  CONFIGURATION,
  DESCRIPTOR,
  errorCodes,
  HANDOVER,
  HEADER,
  KEY_NEW,
  KEY_OLD,
  KEY_OTHER,
  MANAGER,
  ORDER,
  pinnedOf,
  rejectionOf,
  rig,
  world,
  ZERO,
  type World,
} from './doubles';
import { boundAttempt } from './prepare-fixtures';

const open = (overrides: Partial<World>, handover: Handover) => {
  const built = rig(world(overrides));

  return { ...built, run: built.client.initRecoveryGathering(CONFIGURATION, handover, ORDER, { window: 3_600 }) };
};

const refusalCodes = async (overrides: Partial<World>, handover: Handover): Promise<{ codes: string[]; thrown: unknown }> => {
  const thrown = await rejectionOf(open(overrides, handover).run);

  return { codes: errorCodes(thrown), thrown };
};

const position = (block: number, index = 0): LogPosition => ({
  blockNumber: block,
  blockHash: `0x${block.toString(16).padStart(64, 'b')}`,
  logIndex: index,
  transactionHash: `0x${(block * 1000 + index).toString(16).padStart(64, 'c')}`,
  removed: false,
});

/** `abi.encode(address, address)`, the handover payload layout. */
const HANDOVER_ABI = [{ type: 'address' }, { type: 'address' }] as const;

const payloadOf = (newAuthority: Address, removedAuthority: Address) =>
  encodeAbiParameters(HANDOVER_ABI, [newAuthority, removedAuthority]);

const started = (attemptId: bigint, payload: `0x${string}`, block: number): KitNotification => ({
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

const consumed = (attemptId: bigint, block: number): KitNotification => ({
  kind: 'attempt-consumed',
  account: ACCOUNT,
  action: ACTION,
  attemptId,
  at: position(block),
});

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

/** A previous handover installing `KEY_OLD`, the key the next handover removes. */
const PREVIOUS = [started(2n, payloadOf(KEY_OLD, KEY_OTHER), 200), consumed(2n, 201)];

describe('the init checks the handover', () => {
  it('a zero new key refuses with a handover finding, before the codec encodes', async () => {
    const built = open({}, { newAuthority: ZERO, removedAuthority: KEY_OLD });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown).length).toBeGreaterThan(0);
    expect(errorCodes(thrown).every((code) => code.startsWith('handover.'))).toBe(true);
    expect(built.codec.encoded).toEqual([]);
  });

  it('a zero removed key refuses with a handover finding, before the codec encodes', async () => {
    const built = open({}, { newAuthority: KEY_NEW, removedAuthority: ZERO });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown).length).toBeGreaterThan(0);
    expect(errorCodes(thrown).every((code) => code.startsWith('handover.'))).toBe(true);
    expect(built.codec.encoded).toEqual([]);
  });

  it('the same key twice refuses with handover.same-authority, whatever the spelling', async () => {
    const built = open({}, { newAuthority: KEY_OLD, removedAuthority: KEY_OLD.toLowerCase() as Address });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toContain('handover.same-authority');
    expect(built.codec.encoded).toEqual([]);
  });

  it('a removed key isAuthority denies refuses with handover.removed-not-authority', async () => {
    const { codes, thrown } = await refusalCodes({ authorities: new Set() }, HANDOVER);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toContain('handover.removed-not-authority');
  });

  it('a supplied removed key the chain denies is not replaced by an inferred one, and no event is read', async () => {
    const built = open({ authorities: new Set([KEY_OLD.toLowerCase()]), notifications: PREVIOUS }, { newAuthority: KEY_NEW, removedAuthority: KEY_OTHER });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(callsTo(built.seen, 'events', 'fetch')).toEqual([]);
    expect(callsTo(built.seen, 'provider', 'transaction')).toEqual([]);
  });

  it('a new key already privileged refuses with handover.new-holds-privilege', async () => {
    const { codes, thrown } = await refusalCodes({ privileged: new Set([KEY_NEW.toLowerCase()]) }, HANDOVER);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toContain('handover.new-holds-privilege');
  });

  it('both failures at once come back as one refusal carrying both codes', async () => {
    const { codes } = await refusalCodes({ authorities: new Set(), privileged: new Set([KEY_NEW.toLowerCase()]) }, HANDOVER);

    expect(codes).toEqual(expect.arrayContaining(['handover.removed-not-authority', 'handover.new-holds-privilege']));
  });

  it('every handover refusal carries findings as a validation result with no warnings left undefined', async () => {
    const { thrown } = await refusalCodes({ privileged: new Set([KEY_NEW.toLowerCase()]) }, HANDOVER);

    expect(Array.isArray((thrown as KitRefusalError).findings?.errors)).toBe(true);
    expect(Array.isArray((thrown as KitRefusalError).findings?.warnings)).toBe(true);
    expect((thrown as KitRefusalError).restoreCause).toBeUndefined();
  });
});

describe('the removed key left out', () => {
  it('a consumed previous handover names its new key as the one removed', async () => {
    const built = open({ notifications: PREVIOUS }, { newAuthority: KEY_NEW });
    const record = await built.run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload)).toEqual({ newAuthority: KEY_NEW, removedAuthority: KEY_OLD });
  });

  it('reads the events, then the privilege writes beside the named key, from the deployment block to the pinned one', async () => {
    const built = open({ notifications: PREVIOUS }, { newAuthority: KEY_NEW });

    await built.run;
    expect(callsTo(built.seen, 'events', 'fetch').map((one) => one.args[1])).toEqual([
      { from: DESCRIPTOR.deployedAt, to: HEADER.number },
      { from: DESCRIPTOR.deployedAt, to: HEADER.number },
    ]);
  });

  it('a previous handover whose key is no longer an authority falls to the setup signer', async () => {
    const notifications = [...PREVIOUS, committedAt(300)];
    const commit = notifications[2] as KitNotification;
    const transactions = new Map([
      [
        commit.at.transactionHash.toLowerCase(),
        { hash: commit.at.transactionHash, from: KEY_OTHER, to: ACCOUNT, input: '0x' as const, blockNumber: 300, blockHash: commit.at.blockHash },
      ],
    ]);
    const built = open(
      { notifications, transactions, authorities: new Set([KEY_OTHER.toLowerCase()]), signer: { value: KEY_OTHER } },
      { newAuthority: KEY_NEW },
    );
    const record = await built.run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload).removedAuthority).toBe(KEY_OTHER);
  });

  it('no handover event and no signer recovery refuses with handover.removed-unknown', async () => {
    const { codes, thrown } = await refusalCodes({ notifications: [committedAt(300)] }, { newAuthority: KEY_NEW });

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toContain('handover.removed-unknown');
  });

  it('a signer recovery answering undefined refuses with handover.removed-unknown and returns no record', async () => {
    const notifications = [committedAt(300)];
    const commit = notifications[0] as KitNotification;
    const transactions = new Map([
      [
        commit.at.transactionHash.toLowerCase(),
        { hash: commit.at.transactionHash, from: KEY_OTHER, to: ACCOUNT, input: '0x' as const, blockNumber: 300, blockHash: commit.at.blockHash },
      ],
    ]);
    const { codes, thrown } = await refusalCodes({ notifications, transactions, signer: { value: undefined } }, { newAuthority: KEY_NEW });

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toContain('handover.removed-unknown');
  });

  it('an unread event fetch refuses with handover.removed-unknown rather than rejecting with the transport error', async () => {
    const { codes, thrown } = await refusalCodes({ failures: new Map([['events.fetch', new Error('down')]]) }, { newAuthority: KEY_NEW });

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toContain('handover.removed-unknown');
  });

  it('the inferred key goes through the same new-key check', async () => {
    const { codes } = await refusalCodes({ notifications: PREVIOUS, privileged: new Set([KEY_NEW.toLowerCase()]) }, { newAuthority: KEY_NEW });

    expect(codes).toContain('handover.new-holds-privilege');
  });

  it('an inferred key equal to the new key refuses as the same authority', async () => {
    const { codes } = await refusalCodes({ notifications: PREVIOUS }, { newAuthority: KEY_OLD });

    expect(codes).toContain('handover.same-authority');
  });

  it('every read of the inference is pinned to the init block', async () => {
    const built = open({ notifications: PREVIOUS }, { newAuthority: KEY_NEW });

    await built.run;

    for (const one of callsTo(built.seen, 'action', 'isAuthority')) expect(one.args[1]).toEqual(pinnedOf(HEADER));
  });
});

describe('the five reachable resolutions of the removed key', () => {
  it('named by inference: the inferred key is encoded', async () => {
    const built = open({ notifications: PREVIOUS }, { newAuthority: KEY_NEW });
    const record = await built.run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload).removedAuthority).toBe(KEY_OLD);
  });

  it('supplied and confirmed: the supplied key is encoded and no event is read', async () => {
    const built = open({ notifications: PREVIOUS }, HANDOVER);
    const record = await built.run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload)).toEqual(HANDOVER);
    expect(callsTo(built.seen, 'events', 'fetch')).toEqual([]);
  });

  it('supplied and denied: handover.removed-not-authority, no removed-unknown', async () => {
    const { codes } = await refusalCodes({ authorities: new Set() }, HANDOVER);

    expect(codes).toContain('handover.removed-not-authority');
    expect(codes).not.toContain('handover.removed-unknown');
  });

  it('nothing named and nothing supplied: handover.removed-unknown, no removed-not-authority', async () => {
    const { codes } = await refusalCodes({ notifications: [] }, { newAuthority: KEY_NEW });

    expect(codes).toContain('handover.removed-unknown');
    expect(codes).not.toContain('handover.removed-not-authority');
  });

  it('supplied but unread (isAuthority answers no boolean): handover.removed-unknown, no removed-not-authority', async () => {
    const { codes, thrown } = await refusalCodes({ authorityAnswers: new Map([[KEY_OLD.toLowerCase(), 'yes']]) }, HANDOVER);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toContain('handover.removed-unknown');
    expect(codes).not.toContain('handover.removed-not-authority');
  });

  it('supplied and rejecting: the init rejects with the read error itself', async () => {
    const failure = new Error('rpc down');
    const thrown = await rejectionOf(open({ failures: new Map([['action.isAuthority', failure]]) }, HANDOVER).run);

    expect(thrown).toBe(failure);
  });
});

/** The previous handover's key and the latest setup commit's signer, both confirmed by `isAuthority`. */
const TWO_KEYS = (() => {
  const notifications = [...PREVIOUS, committedAt(300)];
  const commit = notifications[2] as KitNotification;
  const transactions = new Map([
    [
      commit.at.transactionHash.toLowerCase(),
      { hash: commit.at.transactionHash, from: KEY_OTHER, to: ACCOUNT, input: '0x' as const, blockNumber: 300, blockHash: commit.at.blockHash },
    ],
  ]);

  return { notifications, transactions, authorities: new Set([KEY_OLD.toLowerCase(), KEY_OTHER.toLowerCase()]), signer: { value: KEY_OTHER } };
})();

/** The values of the one `handover.removed-unknown` finding a refusal carries. */
const removedUnknownValues = (thrown: unknown): unknown => {
  const found = ((thrown as KitRefusalError).findings?.errors ?? []).filter((finding) => finding.code === 'handover.removed-unknown');

  expect(found).toHaveLength(1);

  return found[0]?.values;
};

describe('two confirmed keys the handover could remove', () => {
  it('refuse the init with handover.removed-unknown listing both, the walk\'s first, and open no gathering', async () => {
    const built = open(TWO_KEYS, { newAuthority: KEY_NEW });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toEqual(['handover.removed-unknown']);
    expect(removedUnknownValues(thrown)).toStrictEqual({ account: ACCOUNT, removedKey: 'ambiguous', candidates: [KEY_OLD, KEY_OTHER] });
    expect(built.codec.encoded).toEqual([]);
  });

  it('open the gathering once the holder names the key they lost, reading no event', async () => {
    const built = open(TWO_KEYS, { newAuthority: KEY_NEW, removedAuthority: KEY_OTHER });
    const record = await built.run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload)).toEqual({ newAuthority: KEY_NEW, removedAuthority: KEY_OTHER });
    expect(callsTo(built.seen, 'events', 'fetch')).toEqual([]);
    expect(callsTo(built.seen, 'action', 'isAuthority').map((one) => one.args)).toEqual([[KEY_OTHER, pinnedOf(HEADER)]]);
  });

  it.each<[string, Partial<World>, Handover, string]>([
    ['no-source', { notifications: [committedAt(300)] }, { newAuthority: KEY_NEW }, 'no-source'],
    ['not-a-key', { notifications: PREVIOUS, authorities: new Set() }, { newAuthority: KEY_NEW }, 'not-a-key'],
    ['unread', { failures: new Map([['events.fetch', new Error('down')]]) }, { newAuthority: KEY_NEW }, 'unread'],
    ['unread on the supplied key', { authorityAnswers: new Map([[KEY_OLD.toLowerCase(), 'yes']]) }, HANDOVER, 'unread'],
  ])('leave the other causes\' values as they were, with no candidates (%s)', async (_label, overrides, handover, cause) => {
    const thrown = await rejectionOf(open(overrides, handover).run);

    expect(removedUnknownValues(thrown)).toStrictEqual({ account: ACCOUNT, removedKey: cause });
  });
});

/** Each new key nobody can sign for, with the destination name its finding reports. */
const RESERVED: readonly (readonly [string, Address])[] = [
  ['account', ACCOUNT],
  ['manager', MANAGER],
  ['action', ACTION],
  ['kit-slot', oracleKitSlot(ACTION)],
  ['fallback-handler', '0x0000000000000000000000000000000000006969'],
];

describe('the init refuses a new key nobody can sign for', () => {
  it.each(RESERVED)('a new key reserved as %s refuses with handover.new-reserved after the pinned reads, before any request exists', async (reserved, newAuthority) => {
    const built = open({}, { newAuthority, removedAuthority: KEY_OLD });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as KitRefusalError).message).toBe('the handover would not pass the action');
    expect((thrown as KitRefusalError).findings?.errors).toEqual([
      { code: 'handover.new-reserved', subject: 'request', values: { newAuthority: getAddress(newAuthority), reserved } },
    ]);
    expect(built.codec.encoded).toEqual([]);
    expect(callsTo(built.seen, 'action', 'holdsAnyPrivilege').map((one) => one.args)).toEqual([[getAddress(newAuthority), pinnedOf(HEADER)]]);

    for (const one of callsTo(built.seen, 'action', 'isAuthority')) expect(one.args[1]).toEqual(pinnedOf(HEADER));
  });

  it('a kit slot that already holds a privilege refuses once, carrying both codes', async () => {
    const slot = oracleKitSlot(ACTION);
    const { codes, thrown } = await refusalCodes({ privileged: new Set([slot.toLowerCase()]) }, { newAuthority: slot, removedAuthority: KEY_OLD });

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(codes).toEqual(['handover.new-holds-privilege', 'handover.new-reserved']);
  });

  it.each(RESERVED)('a new key reserved as %s refuses the same way when the removed key is inferred', async (reserved, newAuthority) => {
    const built = open({ notifications: PREVIOUS }, { newAuthority });
    const thrown = await rejectionOf(built.run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as KitRefusalError).findings?.errors).toEqual([
      { code: 'handover.new-reserved', subject: 'request', values: { newAuthority: getAddress(newAuthority), reserved } },
    ]);
    expect(built.codec.encoded).toEqual([]);
  });

  it('a new key at the kit slot of another action opens the gathering', async () => {
    const newAuthority = oracleKitSlot(KEY_OTHER);
    const built = open({}, { newAuthority, removedAuthority: KEY_OLD });
    const record = await built.run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload)).toEqual({ newAuthority, removedAuthority: KEY_OLD });
  });
});

describe('a payload installing a key nobody can sign for, past the init', () => {
  it.each(RESERVED)('prepareStartAttempt prepares and simulates a payload whose new key is reserved as %s, with no handover read', async (_reserved, newAuthority) => {
    const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
    const prepared = await built.client.prepareStartAttempt({ ...boundAttempt(), payload: payloadOf(newAuthority, KEY_OLD) }, HEADER.timestamp);

    expect(prepared.simulation).toEqual({ success: true });
    expect(callsTo(built.seen, 'provider', 'call')).toHaveLength(1);
    expect(callsTo(built.seen, 'action', 'holdsAnyPrivilege')).toEqual([]);
    expect(callsTo(built.seen, 'action', 'isAuthority')).toEqual([]);
  });
});
