import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, inferRemovedKey, type Handover, type KitNotification } from '../../src/index';
import {
  ACCOUNT,
  ACCOUNT_FILTER,
  ACTION,
  askedKeys,
  BLOCK,
  cancelled,
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
  OTHER_ACTION,
  positionAt,
  rig,
  started,
  tableCodec,
  transactionAt,
  ZERO,
  type World,
} from './doubles';

const codec = new AmbireActionCodec([ACTION]);

/** A started and consumed attempt installing `newKey` and removing key 4. */
const attempt = (attemptId: number, newKey: string, block: number): KitNotification[] => [
  started(attemptId, handoverPayload(newKey as `0x${string}`, key(4)), { block }),
  consumed(attemptId, { block: block + 1 }),
];

const world = (notifications: readonly KitNotification[], rest: Partial<World> = {}): World => ({
  notifications: { value: notifications },
  authorities: new Set(),
  transactions: nodeFor(notifications),
  ...rest,
});

describe('a supplied address', () => {
  it('is returned once confirmed, and nothing else is read', async () => {
    const history = [...attempt(3, key(1), 200), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(0), key(1), key(2)), signer: { value: key(2) } }), {
      supplied: key(0),
    }, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(0));
    expect(kinds(reads)).toEqual(['isAuthority']);
    expect(askedKeys(reads)).toEqual([key(0).toLowerCase()]);
  });

  it('is returned checksummed when supplied all lower-case or all upper-case', async () => {
    for (const spelling of [key(0).toLowerCase(), `0x${key(0).slice(2).toUpperCase()}`]) {
      const { inputs } = rig(world([], { authorities: keySet(key(0)) }), { supplied: spelling as `0x${string}` }, codec);

      await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(0));
    }
  });

  it('denied: not-a-key at once, even where step 1 would name a confirmed key', async () => {
    const { inputs, reads } = rig(world(attempt(3, key(1), 200), { authorities: keySet(key(1)) }), { supplied: key(0) }, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(kinds(reads)).toEqual(['isAuthority']);
    expect(askedKeys(reads)).toEqual([key(0).toLowerCase()]);
  });

  it('denied: not-a-key with exactly one isAuthority, no fetch, no transaction and no seam call', async () => {
    const history = [...attempt(3, key(1), 200), committed({ block: 300 })];
    const { inputs, reads, filterOptions } = rig(world(history, { authorities: keySet(key(1), key(2)), signer: { value: key(2) } }), { supplied: key(0) }, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(reads).toEqual([{ kind: 'isAuthority', key: key(0), block: BLOCK }]);
    expect(filterOptions).toEqual([]);
  });

  it('denied with nothing else to name: not-a-key', async () => {
    const { inputs } = rig(world([]), { supplied: key(0) }, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
  });
});

describe('nothing named: no-source', () => {
  it('with no supplied address, no consumed attempt and no seam', async () => {
    const { inputs } = rig(world([started(1, handoverPayload(key(1), key(4)), { block: 200 }), committed({ block: 300 })]), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
  });

  it('with a foreign payload and a seam answering undefined', async () => {
    const history = [started(1, FOREIGN_PAYLOAD, { block: 200 }), consumed(1, { block: 201 }), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history, { signer: { value: undefined } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(kinds(reads)).toEqual(['fetch', 'transaction', 'recoverSigner']);
  });

  it('with an empty history and a seam: no transaction is asked for', async () => {
    const { inputs, reads } = rig(world([], { signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(kinds(reads)).toEqual(['fetch']);
  });
});

describe('the reads', () => {
  it('fetch exactly once, over the account filter without allActions, from deployedAt to the pinned block', async () => {
    const history = [...attempt(3, key(1), 200), committed({ block: 300 })];
    const { inputs, reads, filterOptions } = rig(world(history, { signer: { value: key(2) } }), {}, codec);

    await inferRemovedKey(inputs, BLOCK);

    const fetches = reads.filter((read) => read.kind === 'fetch');

    expect(fetches).toEqual([{ kind: 'fetch', filter: ACCOUNT_FILTER, range: { from: DESCRIPTOR.deployedAt, to: BLOCK.number } }]);
    expect(filterOptions.length).toBeGreaterThanOrEqual(1);

    for (const options of filterOptions) expect(options?.allActions ?? false).toBe(false);
  });

  it('pass the given block to every isAuthority', async () => {
    const history = [...attempt(3, key(1), 200), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history, { signer: { value: key(2) } }), {}, codec);

    await inferRemovedKey(inputs, BLOCK);

    const blocks = reads.flatMap((read) => (read.kind === 'isAuthority' ? [read.block] : []));

    expect(blocks).toHaveLength(2);

    for (const block of blocks) expect(block).toEqual(BLOCK);
  });

  it('read nothing from the logs when deployedAt is above the pinned block: no-source, or not-a-key after a denied supplied address', async () => {
    const descriptor = { ...DESCRIPTOR, deployedAt: BLOCK.number + 1 };
    const quiet = rig(world([], { signer: { value: key(2) } }), { descriptor }, codec);

    await expect(inferRemovedKey(quiet.inputs, BLOCK)).resolves.toBe('no-source');
    expect(quiet.reads).toEqual([]);

    const denied = rig(world([], { signer: { value: key(2) } }), { descriptor, supplied: key(0) }, codec);

    await expect(inferRemovedKey(denied.inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(kinds(denied.reads)).toEqual(['isAuthority']);
  });

  it('read the one block when deployedAt is the pinned block', async () => {
    const { inputs, reads } = rig(world([]), { descriptor: { ...DESCRIPTOR, deployedAt: BLOCK.number } }, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(reads).toEqual([{ kind: 'fetch', filter: ACCOUNT_FILTER, range: { from: BLOCK.number, to: BLOCK.number } }]);
  });
});

describe('step 1: the latest consumed attempt', () => {
  it('names the new key of the highest consumed attempt id, never an older one', async () => {
    const history = [...attempt(2, key(2), 200), ...attempt(3, key(1), 210)];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(1), key(2)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(1));
    expect(askedKeys(reads)).toEqual([key(1).toLowerCase()]);
  });

  it('chooses by attempt id, not by log position', async () => {
    const history = [...attempt(5, key(1), 200), ...attempt(3, key(2), 300)];
    const { inputs } = rig(world(history, { authorities: keySet(key(1), key(2)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(1));
  });

  it('never falls back to an older attempt when the latest is denied', async () => {
    const history = [...attempt(2, key(2), 200), ...attempt(3, key(1), 210)];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(2)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(askedKeys(reads)).toEqual([key(1).toLowerCase()]);
  });

  it('never falls back to an older attempt when the latest payload is foreign', async () => {
    const history = [...attempt(2, key(2), 200), started(3, FOREIGN_PAYLOAD, { block: 210 }), consumed(3, { block: 211 })];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(2)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(askedKeys(reads)).toEqual([]);
  });

  it('ignores a started-only, a cancelled and a consumed-only attempt', async () => {
    const history = [
      ...attempt(2, key(2), 200),
      started(3, handoverPayload(key(1), key(4)), { block: 210 }),
      cancelled(3, { block: 211 }),
      started(4, handoverPayload(key(3), key(4)), { block: 220 }),
      consumed(5, { block: 230 }),
    ];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(1), key(2), key(3)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(askedKeys(reads)).toEqual([key(2).toLowerCase()]);
  });

  it('drops a removed consumed log and a removed started log', async () => {
    const history = [
      ...attempt(2, key(2), 200),
      started(3, handoverPayload(key(1), key(4)), { block: 210 }),
      consumed(3, { block: 211, removed: true }),
      started(4, handoverPayload(key(3), key(4)), { block: 220, removed: true }),
      consumed(4, { block: 221 }),
    ];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(1), key(2), key(3)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(askedKeys(reads)).toEqual([key(2).toLowerCase()]);
  });

  it('ignores another account\'s and another action\'s attempts the event manager hands back', async () => {
    const history = [
      ...attempt(2, key(2), 200),
      started(3, handoverPayload(key(1), key(4)), { block: 210 }, { account: OTHER_ACCOUNT }),
      consumed(3, { block: 211 }, { account: OTHER_ACCOUNT }),
      started(4, handoverPayload(key(3), key(4)), { block: 220 }, { action: OTHER_ACTION }),
      consumed(4, { block: 221 }, { action: OTHER_ACTION }),
    ];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(1), key(2), key(3)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(askedKeys(reads)).toEqual([key(2).toLowerCase()]);
  });

  it('asks about the new key, never the removed key', async () => {
    const { inputs, reads } = rig(world(attempt(3, key(1), 200), { authorities: keySet(key(4)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(askedKeys(reads)).toEqual([key(1).toLowerCase()]);
  });

  it('names nothing for a zero new key, without asking isAuthority, and falls to step 2', async () => {
    const history = [started(3, handoverPayload(ZERO, key(4)), { block: 200 }), consumed(3, { block: 201 }), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history, { authorities: keySet(ZERO, key(2)), signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(askedKeys(reads)).toEqual([key(2).toLowerCase()]);
  });

  it('asks about a new key equal to the removed key like any other', async () => {
    const history = [started(3, handoverPayload(key(1), key(1)), { block: 200 }), consumed(3, { block: 201 })];
    const { inputs } = rig(world(history, { authorities: keySet(key(1)) }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(1));
  });

  it('treats any throw of a third-party codec as a payload that does not decode', async () => {
    for (const failure of [new Error('boom'), 'a string', undefined, { odd: true }]) {
      const history = [started(3, '0x01', { block: 200 }), consumed(3, { block: 201 })];
      const { inputs, reads } = rig(world(history, { authorities: keySet(key(1)) }), {}, tableCodec(new Map(), failure));

      await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
      expect(kinds(reads)).toEqual(['fetch']);
    }
  });

  it('decodes through the bound codec, returning its new key checksummed', async () => {
    const handover: Handover = { newAuthority: key(1).toLowerCase() as `0x${string}`, removedAuthority: key(4) };
    const history = [started(3, '0x01', { block: 200 }), consumed(3, { block: 201 })];
    const { inputs } = rig(world(history, { authorities: keySet(key(1)) }), {}, tableCodec(new Map([['0x01', handover]])));

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(1));
  });

  it('is beaten by nothing: step 2 is not read when step 1 confirms', async () => {
    const history = [...attempt(3, key(1), 200), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(1), key(2)), signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(1));
    expect(kinds(reads)).toEqual(['fetch', 'isAuthority']);
  });
});

describe('step 2: the signer of the latest setup commit', () => {
  it('asks for the last committed notification\'s transaction and hands it with the bound account to the seam', async () => {
    const history = [committed({ block: 200 }), committed({ block: 300, index: 2 }), committed({ block: 300, index: 1 })];
    const ordered = [history[0], history[2], history[1]] as KitNotification[];
    const { inputs, reads } = rig(world(ordered, { authorities: keySet(key(2)), signer: { value: key(2).toLowerCase() as `0x${string}` } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));

    const last = positionAt({ block: 300, index: 2 });

    expect(reads.find((read) => read.kind === 'transaction')).toEqual({ kind: 'transaction', hash: last.transactionHash });

    const recovered = reads.find((read) => read.kind === 'recoverSigner');

    expect(recovered).toBeDefined();

    if (recovered?.kind !== 'recoverSigner') return;

    expect(recovered.transaction).toEqual(transactionAt(last));
    expect(recovered.account.toLowerCase()).toBe(ACCOUNT.toLowerCase());
  });

  it('drops a removed committed log and another pair\'s', async () => {
    const history = [
      committed({ block: 200 }),
      committed({ block: 300, removed: true }),
      committed({ block: 310 }, { account: OTHER_ACCOUNT }),
      committed({ block: 320 }, { action: OTHER_ACTION }),
    ];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(2)), signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(reads.find((read) => read.kind === 'transaction')).toEqual({ kind: 'transaction', hash: positionAt({ block: 200 }).transactionHash });
  });

  it('is skipped without a seam: transaction is never called', async () => {
    const history = [...attempt(3, key(1), 200), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(kinds(reads)).toEqual(['fetch', 'isAuthority']);
  });

  it('runs after a step 1 that names nothing', async () => {
    const history = [started(3, FOREIGN_PAYLOAD, { block: 200 }), consumed(3, { block: 201 }), committed({ block: 300 })];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(2)), signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(kinds(reads)).toEqual(['fetch', 'transaction', 'recoverSigner', 'isAuthority']);
  });

  it('a recovered signer that isAuthority denies: not-a-key', async () => {
    const { inputs } = rig(world([committed({ block: 300 })], { signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
  });

  it('accepts a node answer spelled in upper-case hex', async () => {
    const note = committed({ block: 300 });
    const tx = transactionAt(note.at);
    const shouted = { ...tx, hash: `0x${tx.hash.slice(2).toUpperCase()}`, blockHash: `0x${tx.blockHash.slice(2).toUpperCase()}` } as const;
    const transactions = new Map([[note.at.transactionHash.toLowerCase(), { value: shouted as typeof tx }]]);
    const { inputs } = rig(world([note], { authorities: keySet(key(2)), signer: { value: key(2) }, transactions }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
  });
});

describe('a failed read: the supplied key\'s rejects as itself, any other answers unread at once', () => {
  const history = [...attempt(3, key(1), 200), committed({ block: 300 })];

  it.each([
    ['a transport error', new Error('socket hang up')],
    ['a ProviderRevert', { data: '0x' }],
    ['a TypeError from a malformed return', new TypeError('malformed return')],
  ])('isAuthority rejecting with %s on the supplied address: the inference rejects with it and nothing else is read', async (_label, reason) => {
    const { inputs, reads } = rig(
      world(history, { authorities: keySet(key(1)), authorityRejects: new Map([[key(0).toLowerCase(), reason]]), signer: { value: key(2) } }),
      { supplied: key(0) },
      codec,
    );

    await expect(inferRemovedKey(inputs, BLOCK)).rejects.toBe(reason);
    expect(kinds(reads)).toEqual(['isAuthority']);
  });

  it('isAuthority rejecting in step 1: step 2 is not read', async () => {
    const { inputs, reads } = rig(
      world(history, { authorityRejects: new Map([[key(1).toLowerCase(), new Error('down')]]), authorities: keySet(key(2)), signer: { value: key(2) } }),
      {},
      codec,
    );

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch', 'isAuthority']);
  });

  it('isAuthority rejecting in step 2', async () => {
    const { inputs } = rig(
      world([committed({ block: 300 })], { authorityRejects: new Map([[key(2).toLowerCase(), { data: '0x' }]]), signer: { value: key(2) } }),
      {},
      codec,
    );

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
  });

  it.each([['an Error', new Error('down')], ['a string', 'down'], ['undefined', undefined]])(
    'fetch rejecting with %s: nothing else is read',
    async (_label, reason) => {
      const { inputs, reads } = rig({ ...world(history, { authorities: keySet(key(1)), signer: { value: key(2) } }), notifications: { rejects: reason } }, {}, codec);

      await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
      expect(kinds(reads)).toEqual(['fetch']);
    },
  );

  it('transaction rejecting: the seam is not called', async () => {
    const note = committed({ block: 300 });
    const transactions = new Map([[note.at.transactionHash.toLowerCase(), { rejects: new Error('down') }]]);
    const { inputs, reads } = rig(world([note], { authorities: keySet(key(2)), signer: { value: key(2) }, transactions }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch', 'transaction']);
  });

  it('transaction answering undefined for the hash a log named', async () => {
    const { inputs, reads } = rig(
      world([committed({ block: 300 })], { authorities: keySet(key(2)), signer: { value: key(2) }, transactions: new Map() }),
      {},
      codec,
    );

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch', 'transaction']);
  });

  it.each([
    ['another hash', { hash: `0x${'d'.repeat(64)}` }],
    ['another block hash', { blockHash: `0x${'e'.repeat(64)}` }],
  ])('transaction answering %s than the log carries', async (_label, change) => {
    const note = committed({ block: 300 });
    const transactions = new Map([[note.at.transactionHash.toLowerCase(), { value: { ...transactionAt(note.at), ...change } as never }]]);
    const { inputs, reads } = rig(world([note], { authorities: keySet(key(2)), signer: { value: key(2) }, transactions }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch', 'transaction']);
  });

  it.each([['an Error', new Error('cannot')], ['a TypeError', new TypeError('bad signature')], ['a string', 'no']])(
    'recoverSigner rejecting with %s: isAuthority is not asked',
    async (_label, reason) => {
      const { inputs, reads } = rig(world([committed({ block: 300 })], { authorities: keySet(key(2)), signer: { rejects: reason } }), {}, codec);

      await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
      expect(kinds(reads)).toEqual(['fetch', 'transaction', 'recoverSigner']);
    },
  );

  it.each([['not hex', 'nope'], ['a bad checksum', '0xABcdefabcdefabcdefabcdefabcdefabcdefab01'], ['a short address', '0x1234']])(
    'recoverSigner answering %s resolves unread rather than rejecting',
    async (_label, answer) => {
      const { inputs, reads } = rig(
        world([committed({ block: 300 })], { authorities: keySet(key(0)), signer: { value: answer as `0x${string}` } }),
        {},
        codec,
      );

      await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
      expect(kinds(reads)).toEqual(['fetch', 'transaction', 'recoverSigner']);
    },
  );

  it('a later failure is unread even after step 1 named a denied key', async () => {
    const note = committed({ block: 300 });
    const transactions = new Map([[note.at.transactionHash.toLowerCase(), { rejects: new Error('down') }]]);
    const { inputs, reads } = rig(world([...attempt(3, key(1), 200), note], { signer: { value: key(2) }, transactions }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch', 'isAuthority', 'transaction']);
  });
});

describe('malformed answers resolve rather than reject', () => {
  it.each([
    ['a null entry', [null]],
    ['an undefined entry', [undefined]],
    ['an entry without a position', [{ kind: 'attempt-consumed', account: ACCOUNT, action: ACTION, attemptId: 3n }]],
    ['an entry without a kind', [{ account: ACCOUNT, action: ACTION, attemptId: 3n, at: positionAt({ block: 201 }) }]],
    ['an entry whose kind is not a string', [{ kind: 7, account: ACCOUNT, action: ACTION, attemptId: 3n, at: positionAt({ block: 201 }) }]],
    ['an entry whose kind the SDK does not declare', [{ kind: 'mystery', account: ACCOUNT, action: ACTION, attemptId: 3n, at: positionAt({ block: 201 }) }]],
    ['not an array', { length: 1 }],
  ])('fetch answering %s: unread', async (_label, notifications) => {
    const { inputs } = rig({ notifications: { value: notifications as never }, authorities: keySet(key(1)) }, {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
  });

  it('fetch answering a sparse array: unread, no authority read, though its entries would name a confirmed key', async () => {
    const sparse: KitNotification[] = [];

    sparse[3] = started(3, handoverPayload(key(1), key(4)), { block: 200 });
    sparse[7] = consumed(3, { block: 201 });

    const { inputs, reads } = rig({ notifications: { value: sparse }, authorities: keySet(key(1)) }, {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch']);
  });

  it('fetch answering an unknown kind beside a valid attempt: unread, no authority read', async () => {
    const odd = { kind: 'mystery', account: ACCOUNT, action: ACTION, at: positionAt({ block: 150 }) } as unknown as KitNotification;
    const { inputs, reads } = rig({ notifications: { value: [odd, ...attempt(3, key(1), 200)] }, authorities: keySet(key(1)) }, {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(reads)).toEqual(['fetch']);
  });

  describe.each(['blockNumber', 'logIndex'] as const)('a first SetupCommitted whose %s is malformed, a valid one after it', (member) => {
    it.each([['NaN', Number.NaN], ['fractional', 1.5], ['negative', -1], ['2^53', 2 ** 53]])('%s: unread, no transaction and no authority read', async (_label, value) => {
      const bad = committed({ block: 300 });
      const broken = { ...bad, at: { ...bad.at, [member]: value } } as KitNotification;
      const good = committed({ block: 310 });
      const history = [broken, good];
      const { inputs, reads } = rig(world(history, { authorities: keySet(key(2)), signer: { value: key(2) } }), {}, codec);

      await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('unread');
      expect(kinds(reads)).toEqual(['fetch']);
    });
  });

  it.each([['a string', 'true'], ['a number', 1], ['undefined', undefined]])(
    'isAuthority resolving %s never names the key',
    async (_label, answer) => {
      const { inputs } = rig(world(attempt(3, key(1), 200)), {}, codec);
      const asked = { ...inputs, action: { isAuthority: async () => answer as never } };

      await expect(inferRemovedKey(asked, BLOCK)).resolves.not.toBe(key(1));
    },
  );

  it('a transaction with a malformed from still reaches the seam, the key confirmed by isAuthority', async () => {
    const note = committed({ block: 300 });
    const transactions = new Map([[note.at.transactionHash.toLowerCase(), { value: { ...transactionAt(note.at), from: 'nobody' } as never }]]);
    const { inputs, reads } = rig(world([note], { authorities: keySet(key(2)), signer: { value: key(2) }, transactions }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(kinds(reads)).toEqual(['fetch', 'transaction', 'recoverSigner', 'isAuthority']);
  });

  it('a third-party codec decoding to a new key that is not an address names nothing', async () => {
    const history = [started(3, '0x01', { block: 200 }), consumed(3, { block: 201 })];
    const table = new Map([['0x01', { newAuthority: 'not an address' as `0x${string}` }]]);
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(1)) }), {}, tableCodec(table));

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(kinds(reads)).toEqual(['fetch']);
  });
});

describe('a position tie', () => {
  it('between two committed notifications at one position: the later arrival is the last', async () => {
    const first = committed({ block: 300 });
    const second = { ...first, at: { ...first.at, transactionHash: `0x${'f'.repeat(64)}` } } as KitNotification;
    const history = [first, second];
    const { inputs, reads } = rig(world(history, { authorities: keySet(key(2)), signer: { value: key(2) } }), {}, codec);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
    expect(reads.find((read) => read.kind === 'transaction')).toEqual({ kind: 'transaction', hash: `0x${'f'.repeat(64)}` });
  });
});
