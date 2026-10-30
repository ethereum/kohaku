import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, inferRemovedKey, type KitNotification, type PinnedBlock, type RemovedKeyInputs } from '../../src/index';
import {
  ACTION,
  BLOCK,
  committed,
  consumed,
  handoverPayload,
  key,
  keySet,
  kinds,
  nodeFor,
  rig,
  started,
  tableCodec,
  ZERO,
  type Rig,
} from './doubles';

const codec = new AmbireActionCodec([ACTION]);

/** A rig whose every read would answer and name a confirmed key, so only a refusal reads nothing. */
const ready = (overrides: Partial<RemovedKeyInputs> = {}): Rig => {
  const history = [started(3, handoverPayload(key(1), key(4)), { block: 200 }), consumed(3, { block: 201 }), committed({ block: 300 })];

  return rig(
    { notifications: { value: history }, authorities: keySet(key(1), key(2)), transactions: nodeFor(history), signer: { value: key(2) } },
    overrides,
    codec,
  );
};

const refusesBeforeAnyRead = async (subject: Rig): Promise<void> => {
  await expect(async () => inferRemovedKey(subject.inputs, BLOCK)).rejects.toThrow(TypeError);
  expect(subject.reads).toEqual([]);
  expect(subject.filterOptions).toEqual([]);
};

describe('a mis-wired dependency is a TypeError before any read', () => {
  it.each([['undefined', undefined], ['null', null], ['a number', 1], ['an empty object', {}]])('events that are %s', async (_label, events) => {
    await refusesBeforeAnyRead(ready({ events: events as never }));
  });

  it.each(['accountFilter', 'fetch'] as const)('events whose %s is missing or not callable', async (member) => {
    for (const value of [undefined, null, 1, 'fetch', {}]) {
      const subject = ready();
      const events = { ...subject.inputs.events, [member]: value };

      await refusesBeforeAnyRead({ ...subject, inputs: { ...subject.inputs, events: events as never } });
    }
  });

  it.each([['undefined', undefined], ['null', null], ['an empty object', {}], ['a non-callable isAuthority', { isAuthority: true }]])(
    'an action part that is %s',
    async (_label, action) => {
      await refusesBeforeAnyRead(ready({ action: action as never }));
    },
  );

  it.each([['missing', undefined], ['null', null], ['a string', 'decode'], ['an object', {}]])('a codec whose decode is %s', async (_label, decode) => {
    const broken = { actions: [ACTION], encode: tableCodec(new Map()).encode, decode } as never;

    await refusesBeforeAnyRead(ready({ codec: broken }));
  });

  it.each([['undefined', undefined], ['null', null], ['an empty object', {}], ['a non-callable transaction', { transaction: 'x' }]])(
    'a provider that is %s, with a seam',
    async (_label, provider) => {
      await refusesBeforeAnyRead(ready({ provider: provider as never }));
    },
  );

  it('a provider without a callable transaction, even without a seam', async () => {
    const subject = ready({ provider: {} as never, signerRecovery: undefined });

    await refusesBeforeAnyRead(subject);
  });

  it.each([['null', null], ['a number', 7], ['an empty object', {}], ['a non-callable recoverSigner', { recoverSigner: 'x' }]])(
    'a signer recovery that is %s',
    async (_label, signerRecovery) => {
      await refusesBeforeAnyRead(ready({ signerRecovery: signerRecovery as never }));
    },
  );
});

describe('the checked block is what isAuthority receives', () => {
  const shouted = { number: BLOCK.number, hash: `0x${BLOCK.hash.slice(2).toUpperCase()}`, extra: 1 } as unknown as PinnedBlock;

  it('on the supplied address: lower-cased hash, no stray field', async () => {
    const subject = ready({ supplied: key(1) });

    await expect(inferRemovedKey(subject.inputs, shouted)).resolves.toBe(key(1));

    for (const read of subject.reads) if (read.kind === 'isAuthority') expect(read.block).toStrictEqual({ number: BLOCK.number, hash: BLOCK.hash });
  });

  it('in step 2, after a step 1 that names nothing', async () => {
    const subject = ready({ codec: tableCodec(new Map()) });
    const blocks: unknown[] = [];

    await expect(inferRemovedKey(subject.inputs, shouted)).resolves.toBe(key(2));

    for (const read of subject.reads) if (read.kind === 'isAuthority') blocks.push(read.block);

    expect(blocks).toStrictEqual([{ number: BLOCK.number, hash: BLOCK.hash }]);
  });
});

describe('the zero new key, compared through the package guard', () => {
  it.each([['checksummed', ZERO], ['upper-case', `0x${'0'.repeat(40)}`]])('a %s zero new key names nothing', async (_label, zero) => {
    const history = [started(3, '0x01', { block: 200 }), consumed(3, { block: 201 })];
    const table = new Map([['0x01', { newAuthority: zero as `0x${string}`, removedAuthority: key(4) }]]);
    const subject = rig({ notifications: { value: history }, authorities: keySet(ZERO) }, {}, tableCodec(table));

    await expect(inferRemovedKey(subject.inputs, BLOCK)).resolves.toBe('no-source');
    expect(kinds(subject.reads)).toEqual(['fetch']);
  });
});

describe('a long history', () => {
  it('of 500 consumed attempts names the highest one\'s key in under a second', async () => {
    const history: KitNotification[] = [];

    for (let attemptId = 1; attemptId <= 500; attemptId += 1) {
      history.push(started(attemptId, handoverPayload(key(attemptId % 5), key(5)), { block: 200 + attemptId * 2 }));
      history.push(consumed(attemptId, { block: 201 + attemptId * 2 }));
    }

    const subject = rig({ notifications: { value: history }, authorities: keySet(key(0)) }, { descriptor: { ...ready().inputs.descriptor, deployedAt: 0 } }, codec);
    const begun = performance.now();

    await expect(inferRemovedKey(subject.inputs, { number: 5000, hash: BLOCK.hash })).resolves.toBe(key(0));
    expect(performance.now() - begun).toBeLessThan(1000);
  });
});

describe('an unknown transaction answered as null', () => {
  it('is unread, and the seam is never called', async () => {
    const note = committed({ block: 300 });
    const transactions = new Map([[note.at.transactionHash.toLowerCase(), { value: null as never }]]);
    const subject = rig({ notifications: { value: [note] }, authorities: keySet(key(2)), transactions, signer: { value: key(2) } }, {}, codec);

    await expect(inferRemovedKey(subject.inputs, BLOCK)).resolves.toBe('unread');
    expect(kinds(subject.reads)).toEqual(['fetch', 'transaction']);
  });
});
