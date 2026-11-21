import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EventManager,
  type BlockRange,
  type FetchedNotifications,
  type FilterSpec,
  type Hex,
  type IEventManager,
  type KitNotification,
  type LogPosition,
  type RawLog,
  type SkippedLog,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  addressTopic,
  eventLog,
  makeReader,
  MALFORMED_OWNED,
  MANAGER,
  METHOD_AADHAAR,
  positionOfLog,
  providerDouble,
  rawLog,
  REGISTERED_MODULE,
  STRANGER,
  thrownBy,
  TOPIC0,
} from './fixture';

const consumed = (blockNumber: number, logIndex: number, attemptId: bigint): RawLog =>
  eventLog(MANAGER, 'AttemptConsumed', { account: ACCOUNT, action: ACTION, attemptId }, { blockNumber, logIndex });

/** One owned log per block the chunk covers, so the result shows which blocks were read. */
const logPerBlock = async (range: BlockRange): Promise<readonly RawLog[]> => {
  const logs: RawLog[] = [];

  for (let block = range.from; block <= range.to; block += 1) logs.push(consumed(block, 0, BigInt(block)));

  return logs;
};

const rangesOf = (calls: readonly { range: BlockRange }[]): BlockRange[] => calls.map((call) => call.range);

describe('fetch: chunking by the configured width', () => {
  it('a range wider than one chunk is read in exact consecutive chunks, the last one ending at the last block', async () => {
    const provider = providerDouble();

    // A chunk of width W covers [from, from + W - 1], both ends inclusive.
    await makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 5, to: 31 });
    expect(rangesOf(provider.calls)).toEqual([
      { from: 5, to: 14 },
      { from: 15, to: 24 },
      { from: 25, to: 31 },
    ]);
  });

  it('a range that is an exact multiple of the width ends on a full chunk', async () => {
    const provider = providerDouble();

    await makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 29 });
    expect(rangesOf(provider.calls)).toEqual([
      { from: 0, to: 9 },
      { from: 10, to: 19 },
      { from: 20, to: 29 },
    ]);
  });

  it('a range narrower than the width, or a single block, is one read', async () => {
    const narrow = providerDouble();
    const single = providerDouble();

    await makeReader(narrow, 1000).fetch(makeReader().accountFilter(), { from: 100, to: 150 });
    await makeReader(single, 1000).fetch(makeReader().accountFilter(), { from: 42, to: 42 });
    expect(rangesOf(narrow.calls)).toEqual([{ from: 100, to: 150 }]);
    expect(rangesOf(single.calls)).toEqual([{ from: 42, to: 42 }]);
  });

  it.each([1, 42, 1000])('the empty window from %i to the block before it resolves empty and reads nothing', async (block) => {
    const provider = providerDouble(logPerBlock);

    await expect(makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: block, to: block - 1 })).resolves.toEqual({
      notifications: [],
      skipped: [],
    });
    expect(provider.calls).toHaveLength(0);
  });

  it.each([
    [1, 0, 6],
    [3, 7, 7],
    [4, 1, 20],
    [7, 100, 199],
    [50, 1, 1000],
  ])('width %i over %i..%i: chunks tile the range with no gap, no overlap and none wider than the width', async (width, from, to) => {
    const provider = providerDouble();

    await makeReader(provider, width).fetch(makeReader().accountFilter(), { from, to });
    const ranges = rangesOf(provider.calls);

    expect(ranges[0]?.from).toBe(from);
    expect(ranges.at(-1)?.to).toBe(to);
    ranges.forEach((range, index) => {
      expect(range.to - range.from + 1).toBeLessThanOrEqual(width);
      expect(range.to).toBeGreaterThanOrEqual(range.from);

      if (index > 0) expect(range.from).toBe((ranges[index - 1]?.to ?? Number.NaN) + 1);
    });
    expect(ranges.length).toBe(Math.ceil((to - from + 1) / width));
  });

  it('hands every chunk the caller\'s filter unchanged', async () => {
    const provider = providerDouble();
    const filter = makeReader().methodFilter();

    await makeReader(provider, 10).fetch(filter, { from: 0, to: 25 });

    for (const call of provider.calls) expect(call.filter).toEqual(filter);
  });
});

describe('the chunk width as a sixth constructor argument', () => {
  it('the constructor declares six parameters', () => {
    expect(EventManager.length).toBe(6);
  });

  it.each([0, -1, 1.5, Number.NaN])('a width of %s is refused at construction', (width) => {
    expect(() => makeReader(providerDouble(), width)).toThrow();
  });
});

describe('fetch: order and content', () => {
  it('returns every chunk\'s notifications in log order across chunks', async () => {
    const provider = providerDouble(logPerBlock);
    const { notifications } = await makeReader(provider, 4).fetch(makeReader().accountFilter(), { from: 1, to: 10 });

    expect(notifications.map((entry) => entry.at.blockNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(notifications.map((entry) => (entry.kind === 'attempt-consumed' ? entry.attemptId : -1n))).toEqual(
      [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n],
    );
  });

  it('keeps several logs of one block in log-index order and mixes owned emitters', async () => {
    const provider = providerDouble(async (range) =>
      range.from === 0
        ? [consumed(3, 0, 1n), eventLog(METHOD_AADHAAR, 'Paused', { account: STRANGER }, { blockNumber: 3, logIndex: 1 }), consumed(3, 2, 2n)]
        : [consumed(12, 0, 3n)],
    );
    const { notifications } = await makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 19 });

    expect(notifications.map((entry) => [entry.kind, entry.at.blockNumber, entry.at.logIndex])).toEqual([
      ['attempt-consumed', 3, 0],
      ['method-paused', 3, 1],
      ['attempt-consumed', 3, 2],
      ['attempt-consumed', 12, 0],
    ]);
  });

  it('a provider answering within a chunk out of order still yields log order', async () => {
    const provider = providerDouble(async () => [consumed(9, 4, 3n), consumed(7, 1, 1n), consumed(9, 0, 2n)]);
    const { notifications } = await makeReader(provider, 100).fetch(makeReader().accountFilter(), { from: 0, to: 50 });

    expect(notifications.map((entry) => [entry.at.blockNumber, entry.at.logIndex])).toEqual([
      [7, 1],
      [9, 0],
      [9, 4],
    ]);
  });

  it('leaves out a log the reader does not own', async () => {
    const provider = providerDouble(async () => [
      consumed(1, 0, 1n),
      eventLog(STRANGER, 'Paused', { account: STRANGER }, { blockNumber: 1, logIndex: 1 }),
    ]);
    const { notifications } = await makeReader(provider, 100).fetch(makeReader().methodFilter(), { from: 0, to: 10 });

    expect(notifications.map((entry) => entry.kind)).toEqual(['attempt-consumed']);
  });

  it('an empty answer from every chunk is an empty list', async () => {
    await expect(makeReader(providerDouble(), 5).fetch(makeReader().accountFilter(), { from: 0, to: 12 })).resolves.toEqual({
      notifications: [],
      skipped: [],
    });
  });
});

describe('fetch: failures', () => {
  it.each([0, 1, 2])('chunk %i failing rejects the whole call with the provider\'s error', async (failing) => {
    const failure = new Error(`node refused chunk ${failing}`);
    const provider = providerDouble(async (range) => {
      if (range.from === failing * 10) throw failure;

      return logPerBlock(range);
    });

    await expect(makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 29 })).rejects.toBe(failure);
  });

  it('a reversed range is rejected rather than answered empty, and reads nothing', async () => {
    const provider = providerDouble(logPerBlock);

    await expect(makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 20, to: 10 })).rejects.toThrow();
    expect(provider.calls).toEqual([]);
  });

  it('an owned but malformed log does not reject the call: it resolves with the log skipped', async () => {
    const good = consumed(1, 0, 1n);
    const bad = { ...good, logIndex: 1, topics: good.topics.slice(0, 2) };
    const provider = providerDouble(async () => [good, bad]);
    const { notifications, skipped } = await makeReader(provider, 100).fetch(makeReader().accountFilter(), { from: 0, to: 10 });

    expect(notifications.map((entry) => entry.kind)).toEqual(['attempt-consumed']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.log).toBe(bad);
  });
});

/** A `Paused` whose account sits in a topic, from a registered module: owned, and its layout does not decode. */
const indexedPaused = (blockNumber: number, logIndex: number, removed?: boolean): RawLog =>
  rawLog(REGISTERED_MODULE, [TOPIC0.Paused, addressTopic(STRANGER)], '0x', {
    blockNumber,
    logIndex,
    ...(removed === undefined ? {} : { removed }),
  });

/** One fetch over a single chunk the provider answers with the given logs. */
const fetchOne = (logs: readonly RawLog[]): Promise<FetchedNotifications> =>
  makeReader(providerDouble(async () => logs), 100).fetch(makeReader().accountFilter(), { from: 0, to: 50 });

/** Asserts the entry lists the log: the provider's own object, its position, and an error of the class and message `decodeLog` throws on it. */
const expectSkipped = (entry: SkippedLog | undefined, log: RawLog): void => {
  const thrown = thrownBy(log) as Error;

  expect(entry).toBeDefined();
  expect(entry?.log).toBe(log);
  expect(entry?.at).toEqual(positionOfLog(log));
  expect((entry?.error as Error).constructor).toBe(thrown.constructor);
  expect((entry?.error as Error).message).toBe(thrown.message);
};

/** The hex with its digits in upper case. */
const shout = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;

describe('fetch: an owned log that does not decode is skipped rather than failing the read', () => {
  it('a malformed log between valid ones in the middle chunk: every valid notification in log order, the log skipped once, each chunk read once', async () => {
    const malformed = indexedPaused(12, 1);
    const valid = [consumed(3, 0, 1n), consumed(12, 0, 2n), consumed(12, 2, 3n), consumed(25, 0, 4n)];
    const provider = providerDouble(async (range) => {
      if (range.from === 0) return [valid[0] as RawLog];

      if (range.from === 10) return [valid[1] as RawLog, malformed, valid[2] as RawLog];

      return [valid[3] as RawLog];
    });
    const { notifications, skipped } = await makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 29 });

    expect(notifications).toEqual(valid.map((log) => makeReader().decodeLog(log)));
    expect(notifications.map((entry) => [entry.at.blockNumber, entry.at.logIndex])).toEqual([
      [3, 0],
      [12, 0],
      [12, 2],
      [25, 0],
    ]);
    expect(skipped).toHaveLength(1);
    expectSkipped(skipped[0], malformed);
    expect(rangesOf(provider.calls)).toEqual([
      { from: 0, to: 9 },
      { from: 10, to: 19 },
      { from: 20, to: 29 },
    ]);
  });

  it.each(MALFORMED_OWNED)('%s: listed in skipped, the valid logs around it decoded', async (_label, make) => {
    const malformed = make({ blockNumber: 5, logIndex: 1 });
    const { notifications, skipped } = await fetchOne([consumed(5, 0, 1n), malformed, consumed(5, 2, 2n)]);

    expect(notifications.map((entry) => [entry.kind, entry.at.logIndex])).toEqual([
      ['attempt-consumed', 0],
      ['attempt-consumed', 2],
    ]);
    expect(skipped).toHaveLength(1);
    expectSkipped(skipped[0], malformed);
  });

  it("lists the log as the provider returned it, its position read the way a notification's is", async () => {
    const plain = indexedPaused(7, 3);
    const shouted: RawLog = { ...plain, blockHash: shout(plain.blockHash), transactionHash: shout(plain.transactionHash) };
    const { skipped } = await fetchOne([shouted]);

    expect(skipped[0]?.log).toBe(shouted);
    expect(shouted.blockHash).toBe(shout(plain.blockHash));
    expect(skipped[0]?.at).toEqual({
      blockNumber: 7,
      blockHash: plain.blockHash.toLowerCase(),
      logIndex: 3,
      transactionHash: plain.transactionHash.toLowerCase(),
      removed: false,
    });
  });

  it('a range holding only an undecodable log resolves with that log skipped, never as an empty read', async () => {
    const malformed = indexedPaused(1, 0);
    const { notifications, skipped } = await fetchOne([malformed]);

    expect(notifications).toEqual([]);
    expect(skipped.map((entry) => entry.log)).toEqual([malformed]);
  });
});

describe('fetch: a log that is not owned, or that decodes, is never skipped', () => {
  it.each(MALFORMED_OWNED)('%s, from an unowned address: neither a notification nor skipped', async (_label, make) => {
    const foreign: RawLog = { ...make({ blockNumber: 5, logIndex: 1 }), address: STRANGER };
    const { notifications, skipped } = await fetchOne([consumed(5, 0, 1n), foreign]);

    expect(notifications.map((entry) => entry.kind)).toEqual(['attempt-consumed']);
    expect(skipped).toEqual([]);
  });

  it('an owned address emitting an event that is not its own, or no topic: neither a notification nor skipped', async () => {
    const logs = [
      rawLog(ACCOUNT, [`0x${'ee'.repeat(32)}`, `0x${'00'.repeat(32)}`], '0x', { blockNumber: 1, logIndex: 0 }),
      eventLog(MANAGER, 'Paused', { account: STRANGER }, { blockNumber: 1, logIndex: 1 }),
      eventLog(ACCOUNT, 'Paused', { account: STRANGER }, { blockNumber: 1, logIndex: 2 }),
      eventLog(METHOD_AADHAAR, 'AttemptConsumed', { account: ACCOUNT, action: ACTION, attemptId: 1n }, { blockNumber: 1, logIndex: 3 }),
      rawLog(MANAGER, [], '0x', { blockNumber: 1, logIndex: 4 }),
    ];

    await expect(fetchOne(logs)).resolves.toEqual({ notifications: [], skipped: [] });
  });

  it.each([
    [
      'an address topic whose upper bytes are not zero',
      rawLog(METHOD_AADHAAR, [TOPIC0.AdminRenounced, `0x${'ff'.repeat(12)}${STRANGER.slice(2).toLowerCase()}`], '0x', { blockNumber: 2 }),
    ],
    [
      'a trailing data word',
      (() => {
        const log = eventLog(MANAGER, 'SetupCleared', { account: ACCOUNT, action: ACTION, nonce: 1n }, { blockNumber: 2 });

        return { ...log, data: `${log.data}${'00'.repeat(32)}` as Hex };
      })(),
    ],
  ])('an owned log with %s decodes as decodeLog decodes it and is not skipped', async (_label, log) => {
    const decoded = makeReader().decodeLog(log);

    expect(decoded).toBeDefined();
    await expect(fetchOne([log])).resolves.toEqual({ notifications: [decoded], skipped: [] });
  });
});

describe('fetch: the skipped list', () => {
  it('several skipped logs across chunks, answered out of order, come back in log order', async () => {
    const answers = new Map<number, RawLog[]>([
      [0, [indexedPaused(9, 4), consumed(9, 2, 1n), indexedPaused(3, 1), indexedPaused(9, 0)]],
      [10, [indexedPaused(15, 0)]],
      [20, [indexedPaused(27, 3), consumed(22, 0, 2n), indexedPaused(21, 6)]],
    ]);
    const provider = providerDouble(async (range) => answers.get(range.from) ?? []);
    const { notifications, skipped } = await makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 29 });
    const malformed = [...answers.values()].flat().filter((log) => log.address === REGISTERED_MODULE);
    const inOrder = [...malformed].sort((left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex);

    expect(skipped.map((entry) => [entry.at.blockNumber, entry.at.logIndex])).toEqual([
      [3, 1],
      [9, 0],
      [9, 4],
      [15, 0],
      [21, 6],
      [27, 3],
    ]);
    skipped.forEach((entry, index) => expectSkipped(entry, inOrder[index] as RawLog));
    expect(notifications.map((entry) => [entry.at.blockNumber, entry.at.logIndex])).toEqual([
      [9, 2],
      [22, 0],
    ]);
  });

  it('a removed malformed log keeps its removal flag, and one the provider reported live stays live', async () => {
    const { skipped } = await fetchOne([indexedPaused(4, 1), indexedPaused(4, 0, true), indexedPaused(4, 2, false)]);

    expect(skipped.map((entry) => [entry.at.logIndex, entry.at.removed])).toEqual([
      [0, true],
      [1, false],
      [2, false],
    ]);
  });

  it('the same range read twice answers the same record', async () => {
    const logs = [consumed(2, 0, 1n), indexedPaused(2, 1), ...MALFORMED_OWNED.map(([, make], index) => make({ blockNumber: 3, logIndex: index }))];
    const reader = makeReader(providerDouble(async () => logs), 100);
    const first = await reader.fetch(reader.accountFilter(), { from: 0, to: 9 });
    const second = await reader.fetch(reader.accountFilter(), { from: 0, to: 9 });

    expect(first.skipped).toHaveLength(MALFORMED_OWNED.length + 1);
    expect(second).toEqual(first);
  });
});

describe('fetch: the faults that still reject the read', () => {
  it.each([0, 1, 2])('chunk %i failing rejects with the provider\'s error even where another chunk holds a skipped log', async (failing) => {
    const failure = new Error(`node refused chunk ${failing}`);
    const provider = providerDouble(async (range) => {
      if (range.from === failing * 10) throw failure;

      return [consumed(range.from, 0, 1n), indexedPaused(range.from, 1)];
    });

    await expect(makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 29 })).rejects.toBe(failure);
  });

  it.each<[string, (log: RawLog) => unknown]>([
    ['data that is not a string', (log) => ({ ...log, data: 42 })],
    ['no data', (log) => ({ ...log, data: undefined })],
    ['a topic that is not a string', (log) => ({ ...log, topics: [log.topics[0], 7] })],
    ['topics that are not an array', (log) => ({ ...log, topics: '0x' })],
    ['a block hash that is not a string', (log) => ({ ...log, blockHash: null })],
    ['an address that is not a string', (log) => ({ ...log, address: 42 })],
  ])('a log carrying %s rejects the read rather than being skipped', async (_label, spoil) => {
    const provider = providerDouble(async () => [consumed(1, 0, 1n), spoil(consumed(1, 1, 2n)) as RawLog]);

    await expect(makeReader(provider, 100).fetch(makeReader().accountFilter(), { from: 0, to: 10 })).rejects.toThrow(TypeError);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', {}],
  ])('a chunk answered with %s rejects the read', async (_label, answer) => {
    const provider = providerDouble(async () => answer as never);

    await expect(makeReader(provider, 100).fetch(makeReader().accountFilter(), { from: 0, to: 10 })).rejects.toThrow(TypeError);
  });

  it('a reversed range rejects with a RangeError and reads nothing, whatever the provider would answer', async () => {
    const provider = providerDouble(async () => [indexedPaused(15, 0)]);

    await expect(makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 20, to: 10 })).rejects.toThrow(RangeError);
    expect(provider.calls).toEqual([]);
  });
});

describe('the record fetch resolves to', () => {
  it('fetch resolves the notifications and the skipped logs; decodeLog keeps its answer', () => {
    expectTypeOf<IEventManager['fetch']>().parameters.toEqualTypeOf<[FilterSpec, BlockRange]>();
    expectTypeOf<IEventManager['fetch']>().returns.toEqualTypeOf<Promise<FetchedNotifications>>();
    expectTypeOf<EventManager['fetch']>().returns.toEqualTypeOf<Promise<FetchedNotifications>>();
    expectTypeOf<IEventManager['decodeLog']>().returns.toEqualTypeOf<KitNotification | undefined>();
    expectTypeOf<FetchedNotifications>().toEqualTypeOf<{ readonly notifications: readonly KitNotification[]; readonly skipped: readonly SkippedLog[] }>();
    expectTypeOf<SkippedLog>().toEqualTypeOf<{ readonly at: LogPosition; readonly log: RawLog; readonly error: unknown }>();
  });
});

describe('fetch and decodeLog never read code', () => {
  it('neither a multi-chunk fetch nor decodeLog on owned and foreign logs calls code', async () => {
    const provider = providerDouble(logPerBlock);
    const reader = makeReader(provider, 4);
    const { notifications } = await reader.fetch(reader.accountFilter(), { from: 1, to: 10 });

    expect(notifications).toHaveLength(10);
    expect(provider.calls).toHaveLength(3);

    expect(reader.decodeLog(consumed(11, 0, 11n))?.kind).toBe('attempt-consumed');
    expect(reader.decodeLog(eventLog(METHOD_AADHAAR, 'Paused', { account: ACCOUNT }))).toBeDefined();
    expect(reader.decodeLog(eventLog(STRANGER, 'Paused', { account: STRANGER }))).toBeUndefined();

    expect(provider.codeCalls).toEqual([]);
  });
});
