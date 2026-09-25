import { describe, expect, it } from 'vitest';
import { EventManager, type BlockRange, type RawLog } from '../../src/index';
import { ACCOUNT, ACTION, eventLog, makeReader, MANAGER, METHOD_AADHAAR, providerDouble, STRANGER } from './fixture';

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

    await expect(makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: block, to: block - 1 })).resolves.toEqual([]);
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
    const notifications = await makeReader(provider, 4).fetch(makeReader().accountFilter(), { from: 1, to: 10 });

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
    const notifications = await makeReader(provider, 10).fetch(makeReader().accountFilter(), { from: 0, to: 19 });

    expect(notifications.map((entry) => [entry.kind, entry.at.blockNumber, entry.at.logIndex])).toEqual([
      ['attempt-consumed', 3, 0],
      ['method-paused', 3, 1],
      ['attempt-consumed', 3, 2],
      ['attempt-consumed', 12, 0],
    ]);
  });

  it('a provider answering within a chunk out of order still yields log order', async () => {
    const provider = providerDouble(async () => [consumed(9, 4, 3n), consumed(7, 1, 1n), consumed(9, 0, 2n)]);
    const notifications = await makeReader(provider, 100).fetch(makeReader().accountFilter(), { from: 0, to: 50 });

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
    const notifications = await makeReader(provider, 100).fetch(makeReader().methodFilter(), { from: 0, to: 10 });

    expect(notifications.map((entry) => entry.kind)).toEqual(['attempt-consumed']);
  });

  it('an empty answer from every chunk is an empty list', async () => {
    await expect(makeReader(providerDouble(), 5).fetch(makeReader().accountFilter(), { from: 0, to: 12 })).resolves.toEqual([]);
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

  it('an owned but malformed log rejects the whole call', async () => {
    const good = consumed(1, 0, 1n);
    const provider = providerDouble(async () => [good, { ...good, logIndex: 1, topics: good.topics.slice(0, 2) }]);

    await expect(makeReader(provider, 100).fetch(makeReader().accountFilter(), { from: 0, to: 10 })).rejects.toThrow();
  });
});

describe('fetch and decodeLog never read code', () => {
  it('neither a multi-chunk fetch nor decodeLog on owned and foreign logs calls code', async () => {
    const provider = providerDouble(logPerBlock);
    const reader = makeReader(provider, 4);
    const notifications = await reader.fetch(reader.accountFilter(), { from: 1, to: 10 });

    expect(notifications).toHaveLength(10);
    expect(provider.calls).toHaveLength(3);

    expect(reader.decodeLog(consumed(11, 0, 11n))?.kind).toBe('attempt-consumed');
    expect(reader.decodeLog(eventLog(METHOD_AADHAAR, 'Paused', { account: ACCOUNT }))).toBeDefined();
    expect(reader.decodeLog(eventLog(STRANGER, 'Paused', { account: STRANGER }))).toBeUndefined();

    expect(provider.codeCalls).toEqual([]);
  });
});
