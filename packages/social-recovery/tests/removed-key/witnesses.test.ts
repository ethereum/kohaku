import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, inferRemovedKey, type Address, type KitNotification, type RemovedKeyInputs } from '../../src/index';
import { removedKeyReading } from '../../src/removed-key/infer';
import { bareArray, skippedAt, withSkipped } from '../helpers/fetched';
import {
  ACCOUNT,
  ACCOUNT_FILTER,
  ACTION,
  askedKeys,
  BLOCK,
  committed,
  consumed,
  DESCRIPTOR,
  FOREIGN_PAYLOAD,
  handoverPayload,
  key,
  keySet,
  kinds,
  nodeFor,
  OTHER_ACCOUNT,
  positionAt,
  PRIV_KEY,
  PRIV_NONE,
  PRIV_SLOT,
  privilege,
  PRIVILEGE_FILTER,
  rig,
  started,
  transactionAt,
  type Read,
  type World,
} from './doubles';

const codec = new AmbireActionCodec([ACTION]);

/** A started and consumed attempt installing `newKey` and removing key 5. */
const attempt = (attemptId: number, newKey: Address, block: number): KitNotification[] => [
  started(attemptId, handoverPayload(newKey, key(5)), { block }),
  consumed(attemptId, { block: block + 1 }),
];

/** Step 1 names key 1; the latest setup commit sits after it. */
const STEP_ONE = [...attempt(3, key(1), 200), committed({ block: 300 })];

/** Step 1 names nothing; the latest setup commit's signer is step 2's. */
const STEP_TWO = [started(3, FOREIGN_PAYLOAD, { block: 200 }), consumed(3, { block: 201 }), committed({ block: 300 })];

const world = (notifications: readonly KitNotification[], rest: Partial<World> = {}): World => ({
  notifications: { value: notifications },
  authorities: new Set(),
  transactions: nodeFor(notifications),
  ...rest,
});

/** The privilege scan's answer: the given writes of the bound account. */
const writes = (...notes: readonly KitNotification[]): Pick<World, 'privileges'> => ({ privileges: { value: notes } });

/** The reading and the reads it made, checking `inferRemovedKey` answers the reading's key over the same world. */
const reading = async (given: World, overrides: Partial<RemovedKeyInputs> = {}): Promise<{ key: unknown; candidates: readonly Address[]; reads: Read[] }> => {
  const subject = rig(given, overrides, codec);
  const result = await removedKeyReading(subject.inputs, BLOCK);

  await expect(inferRemovedKey(rig(given, overrides, codec).inputs, BLOCK)).resolves.toBe(result.key);

  return { ...result, reads: subject.reads };
};

/** The fetches over the privilege filter. */
const privilegeFetches = (reads: readonly Read[]): Read[] => reads.filter((read) => read.kind === 'fetch' && read.filter === PRIVILEGE_FILTER);

describe('two confirmed addresses: ambiguous, the walk\'s first', () => {
  it('step 1 names a confirmed key and the setup signer is confirmed too', async () => {
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1), key(2)), signer: { value: key(2) } }));

    expect(result.key).toBe('ambiguous');
    expect(result.candidates).toEqual([key(1), key(2)]);
  });

  it('step 1 names a confirmed key and a privilege write names another confirmed address', async () => {
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1), key(3)), ...writes(privilege(key(3), PRIV_KEY, { block: 150 })) }));

    expect(result.key).toBe('ambiguous');
    expect(result.candidates).toEqual([key(1), key(3)]);
  });

  it('step 2 names a confirmed key and a privilege write names another confirmed address', async () => {
    const result = await reading(
      world(STEP_TWO, { authorities: keySet(key(2), key(3)), signer: { value: key(2) }, ...writes(privilege(key(3), PRIV_KEY, { block: 150 })) }),
    );

    expect(result.key).toBe('ambiguous');
    expect(result.candidates).toEqual([key(2), key(3)]);
  });

  it('lists the signer, then the privilege addresses by the position of their last write, each once and checksummed', async () => {
    const privileges = writes(
      privilege(key(3), PRIV_KEY, { block: 120 }),
      privilege(key(4).toLowerCase() as Address, PRIV_SLOT, { block: 150 }),
      privilege(key(2), PRIV_KEY, { block: 160 }),
      privilege(key(3), PRIV_SLOT, { block: 170, index: 2 }),
    );
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1), key(2), key(3), key(4)), signer: { value: key(2) }, ...privileges }));

    expect(result.key).toBe('ambiguous');
    expect(result.candidates).toEqual([key(1), key(2), key(4), key(3)]);
  });

  it('a write left live under a removed zero write still counts', async () => {
    const privileges = writes(privilege(key(3), PRIV_KEY, { block: 150 }), privilege(key(3), PRIV_NONE, { block: 160, removed: true }));
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1), key(3)), ...privileges }));

    expect(result.key).toBe('ambiguous');
    expect(result.candidates).toEqual([key(1), key(3)]);
  });

  it('a zero write followed by a nonzero one counts', async () => {
    const privileges = writes(privilege(key(3), PRIV_NONE, { block: 150 }), privilege(key(3), PRIV_KEY, { block: 160 }));

    expect((await reading(world(STEP_ONE, { authorities: keySet(key(1), key(3)), ...privileges }))).key).toBe('ambiguous');
  });

  it('a failed witness leaves the other one standing', async () => {
    const transactions = new Map([[positionAt({ block: 300 }).transactionHash.toLowerCase(), { rejects: new Error('down') }]]);
    const given = world(STEP_ONE, { authorities: keySet(key(1), key(2), key(3)), signer: { value: key(2) }, transactions, ...writes(privilege(key(3), PRIV_KEY, { block: 150 })) });
    const result = await reading(given);

    expect(result.key).toBe('ambiguous');
    expect(result.candidates).toEqual([key(1), key(3)]);
  });
});

describe('the walk\'s address named again is no second candidate', () => {
  it.each<[string, Partial<World>]>([
    ['by the setup signer', { signer: { value: key(1) } }],
    ['by the setup signer spelled lower-case', { signer: { value: key(1).toLowerCase() as Address } }],
    ['by a privilege write', writes(privilege(key(1), PRIV_KEY, { block: 150 }))],
    ['by a privilege write spelled lower-case', writes(privilege(key(1).toLowerCase() as Address, PRIV_KEY, { block: 150 }))],
  ])('%s: the key, asked once', async (_label, rest) => {
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1)), ...rest }));

    expect(result.key).toBe(key(1));
    expect(result.candidates).toEqual([]);
    expect(askedKeys(result.reads)).toEqual([key(1).toLowerCase()]);
  });
});

describe('one confirmed address: the walk\'s answer, unchanged', () => {
  const live = writes(privilege(key(3), PRIV_KEY, { block: 150 }));

  it.each<[string, Partial<World>]>([
    ['the witness denied', { authorities: keySet(key(1)), ...live }],
    ['the witness\'s isAuthority rejecting', { authorities: keySet(key(1), key(3)), authorityRejects: new Map([[key(3).toLowerCase(), new Error('down')]]), ...live }],
    ['the witness\'s isAuthority answering a string', { authorities: keySet(key(1), key(3)), authorityAnswers: new Map([[key(3).toLowerCase(), 'true']]), ...live }],
    ['the witness\'s isAuthority answering undefined', { authorities: keySet(key(1), key(3)), authorityAnswers: new Map([[key(3).toLowerCase(), undefined]]), ...live }],
    ['a kit-slot write isAuthority denies', { authorities: keySet(key(1)), ...writes(privilege(key(4), PRIV_SLOT, { block: 150 })) }],
    ['the privilege scan rejecting', { authorities: keySet(key(1), key(3)), privileges: { rejects: new Error('logs down') } }],
    ['the privilege scan answering no array', { authorities: keySet(key(1), key(3)), privileges: { value: { length: 1 } as never } }],
    [
      'the privilege scan skipping a log, its decoded writes unused',
      { authorities: keySet(key(1), key(3)), ...live, privilegesFetched: withSkipped(skippedAt(positionAt({ block: 160 }), new Error('bad log'))) },
    ],
    ['the privilege scan answering a bare array', { authorities: keySet(key(1), key(3)), ...live, privilegesFetched: bareArray }],
    [
      'the privilege scan answering an entry without a position',
      { authorities: keySet(key(1), key(3)), privileges: { value: [{ kind: 'privilege-changed', account: ACCOUNT, addr: key(3), priv: PRIV_KEY }] as never } },
    ],
  ])('%s', async (_label, rest) => {
    const result = await reading(world(STEP_ONE, rest));

    expect(result.key).toBe(key(1));
    expect(result.candidates).toEqual([]);
  });

  it.each<[string, KitNotification[]]>([
    ['written last to zero', [privilege(key(3), PRIV_KEY, { block: 150 }), privilege(key(3), PRIV_NONE, { block: 160 })]],
    ['written last to zero by a lower-case spelling', [privilege(key(3), PRIV_KEY, { block: 150 }), privilege(key(3).toLowerCase() as Address, PRIV_NONE, { block: 160 })]],
    ['written only in a replaced block', [privilege(key(3), PRIV_KEY, { block: 150, removed: true })]],
    ['written by another account', [privilege(key(3), PRIV_KEY, { block: 150 }, OTHER_ACCOUNT)]],
    ['an addr that is no address', [privilege('0xnot-an-address' as Address, PRIV_KEY, { block: 150 })]],
    ['an addr with a bad checksum', [privilege(`0x${key(3).slice(2, 4).toLowerCase()}${key(3).slice(4, 6).toUpperCase()}${key(3).slice(6)}` as Address, PRIV_KEY, { block: 150 })]],
  ])('a privilege address %s is never asked', async (_label, notes) => {
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1), key(3)), ...writes(...notes) }));

    expect(result.key).toBe(key(1));
    expect(askedKeys(result.reads)).toEqual([key(1).toLowerCase()]);
  });

  it.each<[string, Partial<World>]>([
    ['the transaction rejecting', { transactions: new Map([[positionAt({ block: 300 }).transactionHash.toLowerCase(), { rejects: new Error('down') }]]) }],
    ['the transaction unknown', { transactions: new Map() }],
    ['the transaction of another block', { transactions: new Map([[positionAt({ block: 300 }).transactionHash.toLowerCase(), { value: { ...transactionAt(positionAt({ block: 300 })), blockHash: `0x${'e'.repeat(64)}` } }]]) }],
    ['recoverSigner rejecting', { signer: { rejects: new TypeError('bad signature') } }],
    ['recoverSigner answering no address', { signer: { value: 'nope' as Address } }],
    ['recoverSigner answering undefined', { signer: { value: undefined } }],
  ])('the setup signer\'s read failing (%s): the key, never unread', async (_label, rest) => {
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1), key(2)), signer: { value: key(2) }, ...rest }));

    expect(result.key).toBe(key(1));
    expect(result.candidates).toEqual([]);
  });

  it('a kit-slot write is asked at the pinned block and denied', async () => {
    const result = await reading(world(STEP_ONE, { authorities: keySet(key(1)), ...writes(privilege(key(4), PRIV_SLOT, { block: 150 })) }));

    expect(askedKeys(result.reads).sort()).toEqual([key(1), key(4)].map((one) => one.toLowerCase()).sort());
  });
});

describe('an unnamed walk stays as it is and reads no witness', () => {
  const live = writes(privilege(key(3), PRIV_KEY, { block: 150 }));

  it.each<[string, readonly KitNotification[], Partial<World>, string, string[]]>([
    ['no-source', [committed({ block: 300 })], { authorities: keySet(key(3)), ...live }, 'no-source', ['fetch']],
    ['not-a-key', STEP_ONE, { authorities: keySet(key(3)), ...live }, 'not-a-key', ['fetch', 'isAuthority']],
    ['unread from step 1', STEP_ONE, { authorities: keySet(key(2), key(3)), authorityRejects: new Map([[key(1).toLowerCase(), new Error('down')]]), signer: { value: key(2) }, ...live }, 'unread', ['fetch', 'isAuthority']],
    ['unread from step 2', STEP_TWO, { authorities: keySet(key(3)), signer: { rejects: new Error('down') }, ...live }, 'unread', ['fetch', 'transaction', 'recoverSigner']],
  ])('%s', async (_label, notifications, rest, answer, reads) => {
    const result = await reading(world(notifications, rest));

    expect(result.key).toBe(answer);
    expect(result.candidates).toEqual([]);
    expect(kinds(result.reads)).toEqual(reads);
    expect(privilegeFetches(result.reads)).toEqual([]);
  });

  it('deployedAt above the pinned block: nothing is read, the privilege scan neither', async () => {
    const result = await reading(world([], { authorities: keySet(key(3)), signer: { value: key(3) }, ...live }), { descriptor: { ...DESCRIPTOR, deployedAt: BLOCK.number + 1 } });

    expect(result.key).toBe('no-source');
    expect(result.reads).toEqual([]);
  });
});

describe('a supplied address reads one isAuthority, whatever the witnesses', () => {
  it.each([['confirmed', keySet(key(0), key(1), key(2), key(3)), key(0)], ['denied', keySet(key(1), key(2), key(3)), 'not-a-key']])(
    '%s',
    async (_label, authorities, answer) => {
      const given = world(STEP_ONE, { authorities, signer: { value: key(2) }, ...writes(privilege(key(3), PRIV_KEY, { block: 150 })) });
      const result = await reading(given, { supplied: key(0) });

      expect(result.key).toBe(answer);
      expect(result.candidates).toEqual([]);
      expect(result.reads).toEqual([{ kind: 'isAuthority', key: key(0), block: BLOCK }]);
    },
  );
});

describe('the witness reads', () => {
  const given = world(STEP_ONE, {
    authorities: keySet(key(1), key(2), key(3)),
    signer: { value: key(2) },
    ...writes(privilege(key(3), PRIV_KEY, { block: 150 }), privilege(key(4), PRIV_SLOT, { block: 160 })),
  });

  it('scan the privilege filter once, from deployedAt to the pinned block, after the account filter', async () => {
    const { reads } = await reading(given);
    const fetches = reads.flatMap((read) => (read.kind === 'fetch' ? [read] : []));

    expect(fetches).toEqual([
      { kind: 'fetch', filter: ACCOUNT_FILTER, range: { from: DESCRIPTOR.deployedAt, to: BLOCK.number } },
      { kind: 'fetch', filter: PRIVILEGE_FILTER, range: { from: DESCRIPTOR.deployedAt, to: BLOCK.number } },
    ]);
  });

  it('scan the one block when deployedAt is the pinned block', async () => {
    const { reads } = await reading(given, { descriptor: { ...DESCRIPTOR, deployedAt: BLOCK.number } });

    expect(privilegeFetches(reads)).toEqual([{ kind: 'fetch', filter: PRIVILEGE_FILTER, range: { from: BLOCK.number, to: BLOCK.number } }]);
  });

  it('ask every other address at the pinned block, once each', async () => {
    const { reads } = await reading(given);
    const asked = reads.flatMap((read) => (read.kind === 'isAuthority' ? [read] : []));

    expect(asked.map((read) => read.key.toLowerCase()).sort()).toEqual([key(1), key(2), key(3), key(4)].map((one) => one.toLowerCase()).sort());

    for (const read of asked) expect(read.block).toEqual(BLOCK);
  });

  it('read the setup signer through the seam with the bound account', async () => {
    const { reads } = await reading(given);

    expect(reads.filter((read) => read.kind === 'transaction')).toEqual([{ kind: 'transaction', hash: positionAt({ block: 300 }).transactionHash }]);
    expect(reads.flatMap((read) => (read.kind === 'recoverSigner' ? [read.account.toLowerCase()] : []))).toEqual([ACCOUNT.toLowerCase()]);
  });

  it('never read the seam when step 2 named the key', async () => {
    const { reads } = await reading(world(STEP_TWO, { authorities: keySet(key(2), key(3)), signer: { value: key(2) }, ...writes(privilege(key(3), PRIV_KEY, { block: 150 })) }));

    expect(kinds(reads).filter((kind) => kind === 'transaction' || kind === 'recoverSigner')).toEqual(['transaction', 'recoverSigner']);
  });

  it('never read the seam without one', async () => {
    const { reads } = await reading(world(STEP_ONE, { authorities: keySet(key(1)) }));

    expect(kinds(reads).sort()).toEqual(['fetch', 'fetch', 'isAuthority']);
  });
});
