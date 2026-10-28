import { describe, expect, it } from 'vitest';
import type { BlockHeader, Hex, PinnedBlock, PreparedCall } from '../../src/index';
import { ALL_ANSWERS, BLOCK_MEMBERS } from './block-members';
import { BLOCK_TAGS, partOver, SELECTORS } from './fixtures';
import { HEADER, providerDouble } from './provider-double';

const PASSED: PinnedBlock = { number: 7_654_321, hash: `0x${'c3'.repeat(32)}` };

const fresh = () => {
  const double = providerDouble(ALL_ANSWERS);

  return { double, part: partOver(double.provider) };
};

describe.each(BLOCK_MEMBERS)('$name with a passed block', ({ prepare, invoke }) => {
  it('reads no block and calls only at the passed number', async () => {
    const { double, part } = fresh();
    const result = await invoke(part, PASSED);

    expect(double.blockTags).toEqual([]);
    expect(double.calls.every((seen) => seen.block === PASSED.number)).toBe(true);

    if (prepare) expect((result as PreparedCall).block).toStrictEqual(PASSED);
    else expect(double.calls.length).toBeGreaterThan(0);
  });

  it('lower-cases an upper-case hash before using it', async () => {
    const { double, part } = fresh();
    const result = await invoke(part, { number: PASSED.number, hash: `0x${'C3'.repeat(32)}` });

    expect(double.blockTags).toEqual([]);

    if (prepare) expect((result as PreparedCall).block).toStrictEqual(PASSED);
  });

  it('accepts a block header and copies none of its extra members', async () => {
    const { double, part } = fresh();
    const header: BlockHeader = { number: PASSED.number, hash: PASSED.hash, timestamp: 1_800_000_000 };
    const result = await invoke(part, header);

    expect(double.blockTags).toEqual([]);
    expect(double.calls.every((seen) => seen.block === PASSED.number)).toBe(true);

    if (prepare) expect((result as PreparedCall).block).toStrictEqual(PASSED);
  });

  it.each([
    ['omitted', (run: (block?: PinnedBlock) => Promise<unknown>) => run()],
    ['explicit undefined', (run: (block?: PinnedBlock) => Promise<unknown>) => run(undefined)],
  ])('resolves the read tag once when the block is %s', async (_label, call) => {
    const { double, part } = fresh();
    const result = await call((block) => invoke(part, block));

    expect(double.blockTags).toEqual([BLOCK_TAGS.read]);
    expect(double.calls.every((seen) => seen.block === HEADER.number)).toBe(true);

    if (prepare) expect((result as PreparedCall).block).toStrictEqual({ number: HEADER.number, hash: HEADER.hash });
  });

  it.each([
    ['null', null, TypeError, /^block must be an object/],
    ['a number', 7, TypeError, /^block must be an object/],
    ['a string', '0x01', TypeError, /^block must be an object/],
    ['an object missing hash', { number: 1 }, TypeError, /^block\.hash /],
    ['an object missing number', { hash: PASSED.hash }, TypeError, /^block\.number /],
    ['a 31-byte hash', { number: 1, hash: `0x${'c3'.repeat(31)}` }, TypeError, /^block\.hash /],
    ['a 33-byte hash', { number: 1, hash: `0x${'c3'.repeat(33)}` }, TypeError, /^block\.hash /],
    ['a non-hex hash', { number: 1, hash: `0x${'zz'.repeat(32)}` }, TypeError, /^block\.hash /],
    ['an unprefixed hash', { number: 1, hash: 'c3'.repeat(32) }, TypeError, /^block\.hash /],
    ['a negative number', { number: -1, hash: PASSED.hash }, RangeError, /^block\.number /],
    ['an unsafe number', { number: Number.MAX_SAFE_INTEGER + 1, hash: PASSED.hash }, RangeError, /^block\.number /],
    ['a fractional number', { number: 1.5, hash: PASSED.hash }, TypeError, /^block\.number /],
    ['a bigint number', { number: 1n, hash: PASSED.hash }, TypeError, /^block\.number /],
    ['a string number', { number: '1', hash: PASSED.hash }, TypeError, /^block\.number /],
  ] as const)('throws %s naming the field, before any provider call', async (_label, block, kind, message) => {
    const { double, part } = fresh();
    const attempt = () => (async () => invoke(part, block as unknown as PinnedBlock))();

    await expect(attempt()).rejects.toThrow(kind);
    await expect(attempt()).rejects.toThrow(message);
    expect(double.calls).toEqual([]);
    expect(double.blockTags).toEqual([]);
    expect(double.codeReads).toBe(0);
  });
});

describe('actionInfo with a passed block', () => {
  it('makes its three calls at the passed number and reads no block', async () => {
    const { double, part } = fresh();

    await part.actionInfo(PASSED);
    expect(double.blockTags).toEqual([]);
    expect(double.calls.map((seen) => seen.block)).toEqual([PASSED.number, PASSED.number, PASSED.number]);
    expect(double.calls.map((seen) => seen.data.slice(0, 10)).sort()).toEqual(
      [SELECTORS.name, SELECTORS.version, SELECTORS.supportsInterface].sort(),
    );
  });
});

describe('a composite pinned to one passed block', () => {
  it('reads no block across several reads and a prepare, and calls only at that number', async () => {
    const { double, part } = fresh();
    const block: PinnedBlock = { number: 42, hash: `0x${'AB'.repeat(32)}` as Hex };

    const [supported, authorized, info, arming] = await Promise.all([
      part.supportsAccount(block),
      part.isAuthorized(block),
      part.actionInfo(block),
      part.armingCall(block),
    ]);

    expect([supported, authorized, info.supportsInterface]).toEqual([true, false, true]);
    expect(double.blockTags).toEqual([]);
    expect(double.calls).toHaveLength(5);
    expect(double.calls.every((seen) => seen.block === 42)).toBe(true);
    expect(arming.block).toStrictEqual({ number: 42, hash: `0x${'ab'.repeat(32)}` });
  });

  it('does not let a passed block leak into a later call without one', async () => {
    const { double, part } = fresh();

    await part.isAuthorized(PASSED);
    await part.isAuthorized();
    expect(double.blockTags).toEqual([BLOCK_TAGS.read]);
    expect(double.calls.map((seen) => seen.block)).toEqual([PASSED.number, HEADER.number]);
  });
});
