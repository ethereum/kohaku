import { encodeAbiParameters, encodeEventTopics, getAddress, isAddress, type Abi, type AbiEvent } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_EVENTS_ABI,
  EventManager,
  MANAGER_EVENTS_ABI,
  METHOD_EVENTS_ABI,
  type Address,
  type Hex,
  type KitNotification,
  type RawLog,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  DESCRIPTOR,
  eventLog,
  lower,
  makeReader,
  MANAGER,
  METHOD_AADHAAR,
  METHOD_ECDSA,
  METHOD_PASSKEY,
  METHOD_ZKPASSPORT,
  providerDouble,
  rawLog,
  REGISTERED_MODULE,
  SHIPPED_EXTRA,
  STRANGER,
  TOPIC0,
  ZERO,
  type EventName,
} from './fixture';

const H32 = (digit: string): Hex => `0x${digit.repeat(64 / digit.length)}`;
const PLACE = { blockNumber: 777, logIndex: 5 };
const AT = {
  blockNumber: 777,
  blockHash: `0xb${(777).toString(16).padStart(63, '0')}`,
  logIndex: 5,
  transactionHash: `0xc${(777005).toString(16).padStart(63, '0')}`,
  removed: false,
};
const HOLDER_KEY = '0x00000000000000000000000000000000000000a5' as Address;
const NEW_KEY = '0x00000000000000000000000000000000000000b6' as Address;
const SETUP_BODY: Hex = '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2021';

type Case = {
  readonly label: string;
  readonly emitter: Address;
  readonly event: EventName;
  readonly args: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>>;
};

const CASES: readonly Case[] = [
  {
    label: 'setup-committed',
    emitter: MANAGER,
    event: 'SetupCommitted',
    args: { account: ACCOUNT, action: ACTION, nonce: 7n, setupCommitment: H32('3b'), publicMetadata: '0xdead', privateMetadata: '0x1234beef' },
    expected: { kind: 'setup-committed', account: ACCOUNT, action: ACTION, nonce: 7n, setupCommitment: H32('3b'), publicMetadata: '0xdead', privateMetadata: '0x1234beef' },
  },
  {
    label: 'setup-cleared',
    emitter: MANAGER,
    event: 'SetupCleared',
    args: { account: ACCOUNT, action: ACTION, nonce: 8n },
    expected: { kind: 'setup-cleared', account: ACCOUNT, action: ACTION, nonce: 8n },
  },
  {
    label: 'attempt-started (uint48 consumableAfter at its maximum stays a number)',
    emitter: MANAGER,
    event: 'AttemptStarted',
    args: {
      account: ACCOUNT,
      action: ACTION,
      attemptId: 9n,
      setupNonce: 7n,
      setupBody: SETUP_BODY,
      usedPlaces: [0n, 1n, 3n],
      usedMethods: [METHOD_ECDSA, REGISTERED_MODULE],
      payload: '0xabcdef',
      order: { token: SHIPPED_EXTRA, amount: 1234567890123456789n, payee: STRANGER },
      consumableAfter: 2 ** 48 - 1,
    },
    expected: {
      kind: 'attempt-started',
      account: ACCOUNT,
      action: ACTION,
      attemptId: 9n,
      setupNonce: 7n,
      setupBody: SETUP_BODY,
      usedPlaces: [0n, 1n, 3n],
      usedMethods: [METHOD_ECDSA, REGISTERED_MODULE],
      payload: '0xabcdef',
      order: { token: SHIPPED_EXTRA, amount: 1234567890123456789n, payee: STRANGER },
      consumableAfter: 2 ** 48 - 1,
    },
  },
  {
    label: 'attempt-cancelled',
    emitter: MANAGER,
    event: 'AttemptCancelled',
    args: { account: ACCOUNT, action: ACTION, attemptId: 9n, canceller: STRANGER, vetoingMethod: ZERO, setupNonce: 7n, usedPlaces: [2n, 4n] },
    expected: {
      kind: 'attempt-cancelled',
      account: ACCOUNT,
      action: ACTION,
      attemptId: 9n,
      canceller: STRANGER,
      vetoingMethod: ZERO,
      cancelledBy: 'cancelByProofs',
      setupNonce: 7n,
      usedPlaces: [2n, 4n],
    },
  },
  {
    label: 'attempt-consumed',
    emitter: MANAGER,
    event: 'AttemptConsumed',
    args: { account: ACCOUNT, action: ACTION, attemptId: 9n },
    expected: { kind: 'attempt-consumed', account: ACCOUNT, action: ACTION, attemptId: 9n },
  },
  {
    label: 'method-paused (descriptor field)',
    emitter: METHOD_AADHAAR,
    event: 'Paused',
    args: { account: STRANGER },
    expected: { kind: 'method-paused', method: METHOD_AADHAAR, by: STRANGER },
  },
  {
    label: 'method-unpaused (descriptor field)',
    emitter: METHOD_ZKPASSPORT,
    event: 'Unpaused',
    args: { account: STRANGER },
    expected: { kind: 'method-unpaused', method: METHOD_ZKPASSPORT, by: STRANGER },
  },
  {
    label: 'method-keys-updated',
    emitter: METHOD_AADHAAR,
    event: 'TrustedKeysUpdated',
    args: { previous: [H32('01')], current: [H32('02'), H32('03')] },
    expected: { kind: 'method-keys-updated', method: METHOD_AADHAAR, previous: [H32('01')], current: [H32('02'), H32('03')] },
  },
  {
    label: 'method-admin-renounced',
    emitter: METHOD_ZKPASSPORT,
    event: 'AdminRenounced',
    args: { previous: HOLDER_KEY },
    expected: { kind: 'method-admin-renounced', method: METHOD_ZKPASSPORT, previous: HOLDER_KEY },
  },
  {
    label: 'method-admin-transfer-offered',
    emitter: METHOD_AADHAAR,
    event: 'AdminTransferOffered',
    args: { current: HOLDER_KEY, pending: NEW_KEY },
    expected: { kind: 'method-admin-transfer-offered', method: METHOD_AADHAAR, current: HOLDER_KEY, pending: NEW_KEY },
  },
  {
    label: 'method-admin-transferred',
    emitter: METHOD_AADHAAR,
    event: 'AdminTransferred',
    args: { previous: HOLDER_KEY, current: NEW_KEY },
    expected: { kind: 'method-admin-transferred', method: METHOD_AADHAAR, previous: HOLDER_KEY, current: NEW_KEY },
  },
  {
    label: 'method-pause-holder-transfer-started (shippedMethods entry)',
    emitter: SHIPPED_EXTRA,
    event: 'OwnershipTransferStarted',
    args: { previousOwner: HOLDER_KEY, newOwner: NEW_KEY },
    expected: { kind: 'method-pause-holder-transfer-started', method: SHIPPED_EXTRA, previous: HOLDER_KEY, pending: NEW_KEY },
  },
  {
    label: 'method-pause-holder-transferred (registry-only module)',
    emitter: REGISTERED_MODULE,
    event: 'OwnershipTransferred',
    args: { previousOwner: HOLDER_KEY, newOwner: NEW_KEY },
    expected: { kind: 'method-pause-holder-transferred', method: REGISTERED_MODULE, previous: HOLDER_KEY, current: NEW_KEY },
  },
  {
    label: 'privilege-changed (the account as emitter)',
    emitter: ACCOUNT,
    event: 'LogPrivilegeChanged',
    args: { addr: HOLDER_KEY, priv: H32('7f') },
    expected: { kind: 'privilege-changed', account: ACCOUNT, addr: HOLDER_KEY, priv: H32('7f') },
  },
];

describe('decodeLog: the fourteen shapes', () => {
  const reader = makeReader();

  it('covers fourteen distinct kinds, one per event the reader decodes', () => {
    expect(new Set(CASES.map((entry) => entry.expected['kind'])).size).toBe(14);
    expect(new Set(CASES.map((entry) => entry.event)).size).toBe(14);
  });

  it.each(CASES)('$label', ({ emitter, event, args, expected }) => {
    const log = eventLog(emitter, event, args, PLACE);

    expect(log.topics[0]).toBe(TOPIC0[event]);

    const notification = reader.decodeLog(log);

    expect(lower(notification)).toEqual(lower({ ...expected, at: AT }));
  });

  it.each(CASES)('$label: every address field is a well-formed address', ({ emitter, event, args }) => {
    const notification = reader.decodeLog(eventLog(emitter, event, args, PLACE)) as KitNotification;

    for (const [key, value] of Object.entries(notification)) {
      if (typeof value === 'string' && value.length === 42) expect(isAddress(value), key).toBe(true);
    }
  });

  it('the paused method is also owned when named in methodEcdsa or methodPasskey', () => {
    for (const method of [METHOD_ECDSA, METHOD_PASSKEY]) {
      expect(reader.decodeLog(eventLog(method, 'Paused', { account: STRANGER }))?.kind).toBe('method-paused');
    }
  });

  it('ownership ignores the spelling case of the emitting address', () => {
    const log = eventLog(MANAGER.toLowerCase() as Address, 'SetupCleared', { account: ACCOUNT, action: ACTION, nonce: 1n });

    expect(reader.decodeLog(log)?.kind).toBe('setup-cleared');
  });

  it('an upper-case spelling of topic0 decodes like the lower-case one', () => {
    const log = eventLog(MANAGER, 'SetupCleared', { account: ACCOUNT, action: ACTION, nonce: 1n });
    const [first, ...rest] = log.topics;
    const shouted = rawLog(MANAGER, [`0x${(first ?? '').slice(2).toUpperCase()}`, ...rest], log.data);

    expect(reader.decodeLog(shouted)?.kind).toBe('setup-cleared');
  });

  it('carries the removal flag the provider reported, and false where it reported none', () => {
    const args = { account: ACCOUNT, action: ACTION, attemptId: 1n };

    expect(reader.decodeLog(eventLog(MANAGER, 'AttemptConsumed', args, { removed: true }))?.at.removed).toBe(true);
    expect(reader.decodeLog(eventLog(MANAGER, 'AttemptConsumed', args))?.at.removed).toBe(false);
  });
});

describe('decodeLog: logs the reader does not own', () => {
  const reader = makeReader();

  it.each(CASES)('$label with the same topics from an unowned address is undefined', ({ event, args }) => {
    const owned = eventLog(MANAGER, event, args);

    expect(reader.decodeLog(rawLog(STRANGER, owned.topics, owned.data))).toBeUndefined();
  });

  it("a stranger's Paused is undefined", () => {
    expect(reader.decodeLog(eventLog(STRANGER, 'Paused', { account: STRANGER }))).toBeUndefined();
  });

  it('the bound action is not an owned address (it carries no event of its own)', () => {
    const log = eventLog(ACTION, 'SetupCleared', { account: ACCOUNT, action: ACTION, nonce: 1n });

    expect(reader.decodeLog(log)).toBeUndefined();
  });

  it("the descriptor's servedImplementation is not a method", () => {
    expect(reader.decodeLog(eventLog(DESCRIPTOR.servedImplementation, 'Paused', { account: STRANGER }))).toBeUndefined();
  });

  it('a module is owned only while a registered implementation serves it', () => {
    const bare = makeReader(undefined, 1000, new Map());

    expect(bare.decodeLog(eventLog(REGISTERED_MODULE, 'Paused', { account: STRANGER }))).toBeUndefined();
  });

  it('an owned address emitting an event that is not its own is undefined, not thrown', () => {
    const unknown: RawLog = rawLog(ACCOUNT, [`0x${'ee'.repeat(32)}`, `0x${'00'.repeat(32)}`], '0x');

    expect(reader.decodeLog(unknown)).toBeUndefined();
    expect(reader.decodeLog(eventLog(MANAGER, 'Paused', { account: STRANGER }))).toBeUndefined();
    expect(reader.decodeLog(eventLog(ACCOUNT, 'Paused', { account: STRANGER }))).toBeUndefined();
    expect(reader.decodeLog(eventLog(METHOD_AADHAAR, 'AttemptConsumed', { account: ACCOUNT, action: ACTION, attemptId: 1n }))).toBeUndefined();
  });

  it('a log with no topics from an owned address is undefined', () => {
    expect(reader.decodeLog(rawLog(MANAGER, [], '0x'))).toBeUndefined();
  });
});

describe('decodeLog: an owned log whose bytes do not fit the layout (throws)', () => {
  // A layout mismatch must surface as a failure, not an empty stream; these tests pin the current throw.
  const reader = makeReader();
  const cleared = eventLog(MANAGER, 'SetupCleared', { account: ACCOUNT, action: ACTION, nonce: 1n });

  it('a manager event missing its action topic throws', () => {
    expect(() => reader.decodeLog(rawLog(MANAGER, cleared.topics.slice(0, 2), cleared.data))).toThrow();
  });

  it('a manager event with truncated data throws', () => {
    expect(() => reader.decodeLog(rawLog(MANAGER, cleared.topics, '0x01'))).toThrow();
  });

  it('a Paused whose account is indexed instead of in the data throws', () => {
    const indexed = rawLog(METHOD_AADHAAR, [TOPIC0.Paused, `0x${'00'.repeat(12)}${STRANGER.slice(2)}` as Hex], '0x');

    expect(() => reader.decodeLog(indexed)).toThrow();
  });

  it("the account's LogPrivilegeChanged with its value in a topic throws", () => {
    const moved = rawLog(ACCOUNT, [TOPIC0.LogPrivilegeChanged, `0x${'00'.repeat(32)}`, H32('7f')], '0x');

    expect(() => reader.decodeLog(moved)).toThrow();
  });

  it('the same malformed log from an unowned address is still undefined', () => {
    expect(reader.decodeLog(rawLog(STRANGER, cleared.topics.slice(0, 2), cleared.data))).toBeUndefined();
  });
});

/** A log of one event encoded from the given ABI entry rather than the fixture's own ABI. */
const logFromAbi = (address: Address, event: AbiEvent, args: Readonly<Record<string, unknown>>): RawLog => {
  const topics = encodeEventTopics({ abi: [event] as Abi, eventName: event.name, args } as never) as Hex[];
  const unindexed = event.inputs.filter((input) => input.indexed !== true);

  return rawLog(address, topics, encodeAbiParameters(unindexed, unindexed.map((input) => args[input.name ?? ''])), PLACE);
};

describe('decodeLog: every event of the public ABIs has a decoder', () => {
  const reader = makeReader();
  const TABLE: readonly (readonly [string, AbiEvent, Address])[] = [
    ...MANAGER_EVENTS_ABI.map((event) => ['MANAGER_EVENTS_ABI', event, MANAGER] as const),
    ...METHOD_EVENTS_ABI.map((event) => ['METHOD_EVENTS_ABI', event, METHOD_AADHAAR] as const),
    ...ACCOUNT_EVENTS_ABI.map((event) => ['ACCOUNT_EVENTS_ABI', event, ACCOUNT] as const),
  ];

  it('the three ABIs name exactly the events of the shape table', () => {
    expect(TABLE.map(([, event]) => event.name).sort()).toEqual(CASES.map((entry) => entry.event).sort());
  });

  it.each(TABLE.map(([abi, event, emitter]) => [abi, event.name, event, emitter] as const))(
    '%s %s decodes to its notification kind',
    (_abi, name, event, emitter) => {
      const known = CASES.find((entry) => entry.event === name);

      expect(known, `${name} has no row in the shape table`).toBeDefined();

      const { args, expected } = known as Case;

      expect(reader.decodeLog(logFromAbi(emitter, event, args))?.kind).toBe(expected['kind']);
    },
  );
});

const shout = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;

/** The log with its topics, data, block hash and transaction hash in upper-case hex. */
const upperCased = (log: RawLog): RawLog => ({
  ...log,
  topics: log.topics.map(shout),
  data: shout(log.data),
  blockHash: shout(log.blockHash),
  transactionHash: shout(log.transactionHash),
});

/** Every `0x` string in the value that is not a 20-byte address, deeply. */
const hexFields = (value: unknown): string[] => {
  if (typeof value === 'string') return value.startsWith('0x') && value.length !== 42 ? [value] : [];

  if (Array.isArray(value)) return value.flatMap(hexFields);

  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(hexFields);

  return [];
};

describe('decodeLog: the hex spelling of the log', () => {
  const reader = makeReader();

  it.each(CASES)('$label: an upper-case log decodes exactly like its lower-case twin', ({ emitter, event, args }) => {
    const log = eventLog(emitter, event, args, PLACE);

    expect(reader.decodeLog(upperCased(log))).toEqual(reader.decodeLog(log));
  });

  it.each(CASES)('$label: every bytes field and hash of the notification is lower-case', ({ emitter, event, args }) => {
    const fields = hexFields(reader.decodeLog(upperCased(eventLog(emitter, event, args, PLACE))));

    expect(fields.length).toBeGreaterThanOrEqual(2);

    for (const field of fields) expect(field).toBe(field.toLowerCase());
  });

  it('a setup commitment and its metadata come back lower-case', () => {
    const args = { account: ACCOUNT, action: ACTION, nonce: 1n, setupCommitment: H32('ab'), publicMetadata: '0xdead', privateMetadata: '0xbeef' };
    const log = eventLog(MANAGER, 'SetupCommitted', args, PLACE);
    const notification = reader.decodeLog({ ...log, data: shout(log.data), blockHash: shout(log.blockHash) });

    expect(notification).toMatchObject({ setupCommitment: H32('ab'), publicMetadata: '0xdead', privateMetadata: '0xbeef' });
    expect(notification?.at.blockHash).toBe(AT.blockHash);
  });
});

describe('decodeLog and methodFilter agree on a method address in any spelling', () => {
  const upper = `0x${METHOD_AADHAAR.slice(2).toUpperCase()}` as Address;
  const lowerModule = REGISTERED_MODULE.toLowerCase() as Address;
  const checksum = getAddress(METHOD_ZKPASSPORT);
  const reader = new EventManager(
    providerDouble(),
    { ...DESCRIPTOR, methodAadhaar: upper, methodZkpassport: checksum },
    ACCOUNT,
    ACTION,
    new Map([[lowerModule, {} as never]]),
    { logChunkSize: 1000 },
  );
  const filtered = reader.methodFilter().address.map((address) => address.toLowerCase());

  it.each([
    ['upper-case', upper],
    ['checksum', checksum],
    ['lower-case registry key', lowerModule],
  ])('a %s method address is in the filter and owned in every spelling', (_label, method) => {
    expect(filtered).toContain(method.toLowerCase());

    for (const spelling of [method, method.toLowerCase(), `0x${method.slice(2).toUpperCase()}`, getAddress(method)]) {
      expect(reader.decodeLog(eventLog(spelling as Address, 'Paused', { account: STRANGER }))?.kind, spelling).toBe('method-paused');
    }
  });

  it('every address in the filter is owned by decodeLog, and each appears once', () => {
    expect(new Set(filtered).size).toBe(filtered.length);

    for (const address of reader.methodFilter().address) {
      expect(reader.decodeLog(eventLog(address, 'Paused', { account: STRANGER }))?.kind, address).toBe('method-paused');
    }
  });
});
