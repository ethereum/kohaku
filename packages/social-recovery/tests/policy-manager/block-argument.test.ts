import { describe, expect, it } from 'vitest';
import type { BlockHeader, Hex, PinnedBlock, PreparedCall } from '../../src/index';
import { FIRST_BLOCK, always } from './double';
import { ACTION, METHOD, partFor } from './fixtures';
import { MEMBERS, answeringAll } from './members';

const UPPER_HASH = `0x${'CD'.repeat(32)}` as Hex;
const PASSED: PinnedBlock = { number: 18_000_000, hash: UPPER_HASH };
const PINNED: PinnedBlock = { number: 18_000_000, hash: `0x${'cd'.repeat(32)}` };
const HEADER: BlockHeader = { number: 17_999_999, timestamp: 1_800_000_000, hash: `0x${'ef'.repeat(32)}` };
const FINALIZED = { read: 'finalized', watch: 'latest' } as const;

/** A malformed block, the error class the shared guards refuse it with, and the name the message carries. */
const MALFORMED: readonly (readonly [string, unknown, typeof TypeError | typeof RangeError, RegExp])[] = [
  ['null', null, TypeError, /^block must be an object/],
  ['a number', 18_000_000, TypeError, /^block must be an object/],
  ['a string', 'latest', TypeError, /^block must be an object/],
  ['a block without hash', { number: 1 }, TypeError, /^block\.hash /],
  ['a block without number', { hash: PINNED.hash }, TypeError, /^block\.number /],
  ['a 31-byte hash', { number: 1, hash: `0x${'cd'.repeat(31)}` }, TypeError, /^block\.hash /],
  ['a 33-byte hash', { number: 1, hash: `0x${'cd'.repeat(33)}` }, TypeError, /^block\.hash /],
  ['a non-hex hash', { number: 1, hash: `0x${'zz'.repeat(32)}` }, TypeError, /^block\.hash /],
  ['a hash without 0x', { number: 1, hash: 'cd'.repeat(32) }, TypeError, /^block\.hash /],
  ['a fractional number', { number: 1.5, hash: PINNED.hash }, TypeError, /^block\.number /],
  ['a bigint number', { number: 1n, hash: PINNED.hash }, TypeError, /^block\.number /],
  ['a string number', { number: '1', hash: PINNED.hash }, TypeError, /^block\.number /],
  ['a negative number', { number: -1, hash: PINNED.hash }, RangeError, /^block\.number /],
  ['an unsafe number', { number: Number.MAX_SAFE_INTEGER + 1, hash: PINNED.hash }, RangeError, /^block\.number /],
];

describe('a passed block replaces the block read', () => {
  it.each(MEMBERS.map((entry) => [entry.name, entry] as const))('%s reads no block and calls at the passed number', async (_name, entry) => {
    const provider = answeringAll();
    const result = await entry.invoke(partFor(provider, undefined, undefined, FINALIZED), [PASSED]);

    expect(provider.blockTags).toEqual([]);
    expect(provider.calls).toHaveLength(entry.calls);
    expect(provider.calls.every((call) => call.block === PASSED.number)).toBe(true);
    expect(provider.codeReads + provider.logReads + provider.chainIdReads).toBe(0);

    if (entry.prepare) expect((result as PreparedCall).block).toEqual(PINNED);
  });

  it.each(MEMBERS.filter((entry) => entry.prepare).map((entry) => [entry.name, entry] as const))(
    '%s reports a passed BlockHeader as its number and hash only',
    async (_name, entry) => {
      const provider = answeringAll();
      const call = (await entry.invoke(partFor(provider), [HEADER])) as PreparedCall;

      expect(call.block).toStrictEqual({ number: HEADER.number, hash: HEADER.hash });
      expect(Object.keys(call.block).sort()).toEqual(['hash', 'number']);
      expect(provider.blockTags).toEqual([]);
    },
  );

  it('accepts the block number 0 and the largest safe integer', async () => {
    for (const number of [0, Number.MAX_SAFE_INTEGER]) {
      const provider = answeringAll();
      const call = await partFor(provider).prepareClearSetup(ACTION, 1n, { number, hash: PINNED.hash });

      expect(call.block).toEqual({ number, hash: PINNED.hash });
      await partFor(provider).name({ number, hash: PINNED.hash });
      expect(provider.calls[0]?.block).toBe(number);
      expect(provider.blockTags).toEqual([]);
    }
  });

  it('makes moduleInfo\'s three calls at the passed number with no block read', async () => {
    const provider = answeringAll();

    expect(await partFor(provider).moduleInfo(METHOD, PASSED)).toEqual({ answered: true, value: { name: 'n', version: 'v', supportsInterface: true } });
    expect(provider.calls.map((call) => call.block)).toEqual([PASSED.number, PASSED.number, PASSED.number]);
    expect(provider.blockTags).toEqual([]);
  });

  it('keeps the answered rule with a passed block: a revert answers, a provider failure does not', async () => {
    expect(await partFor(always({ reverts: '0x' })).paused(METHOD, PASSED)).toEqual({ answered: true, value: false });
    expect(await partFor(always({ rejects: new Error('down') })).paused(METHOD, PASSED)).toEqual({ answered: false });
    expect(await partFor(always({ rejects: new Error('down') })).trustedParties(METHOD, PASSED)).toEqual({ answered: false });
  });
});

describe('an omitted block keeps the part\'s own block read', () => {
  it.each(MEMBERS.flatMap((entry) => [
    [entry.name, 'omitted', entry, []] as const,
    [entry.name, 'explicitly undefined', entry, [undefined]] as const,
  ]))('%s with the block %s reads the read tag once and calls at that block', async (_name, _how, entry, trailing) => {
    const provider = answeringAll();
    const result = await entry.invoke(partFor(provider, undefined, undefined, FINALIZED), trailing);

    expect(provider.blockTags).toEqual(['finalized']);
    expect(provider.calls).toHaveLength(entry.calls);
    expect(provider.calls.every((call) => call.block === FIRST_BLOCK)).toBe(true);

    if (entry.prepare) expect((result as PreparedCall).block.number).toBe(FIRST_BLOCK);
  });
});

describe('a malformed block throws before any provider call', () => {
  it.each(MEMBERS.flatMap((entry) => MALFORMED.map(([label, block, kind, message]) => [entry.name, label, entry, block, kind, message] as const)))(
    '%s refuses %s',
    async (_name, _label, entry, block, kind, message) => {
      const provider = answeringAll();
      const outcome = await entry.invoke(partFor(provider), [block]).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

      expect(outcome).toBeInstanceOf(kind);
      expect((outcome as Error).message).toMatch(message);
      expect(provider.blockTags).toEqual([]);
      expect(provider.calls).toEqual([]);
    },
  );
});

describe('a malformed header from the provider', () => {
  const badHeader = (header: unknown) => {
    const provider = answeringAll();

    provider.block = async (tag) => {
      provider.blockTags.push(tag);

      return header as BlockHeader;
    };

    return provider;
  };

  it.each([
    ['a 31-byte hash', { number: 1, timestamp: 1, hash: `0x${'cd'.repeat(31)}` }, TypeError, /^block header\.hash /],
    ['a negative number', { number: -1, timestamp: 1, hash: PINNED.hash }, RangeError, /^block header\.number /],
    ['null', null, TypeError, /^block header must be an object/],
  ] as const)('makes a manager read and a prepare throw on %s, named as the block header', async (_case, header, kind, message) => {
    for (const run of [(part: ReturnType<typeof partFor>) => part.name(), (part: ReturnType<typeof partFor>) => part.prepareClearSetup(ACTION, 1n)]) {
      const provider = badHeader(header);
      const outcome = await run(partFor(provider)).then(() => undefined, (thrown: unknown) => thrown);

      expect(outcome).toBeInstanceOf(kind);
      expect((outcome as Error).message).toMatch(message);
      expect(provider.calls).toEqual([]);
    }
  });

  it('makes a module read answer nothing, since the provider failed to name a block', async () => {
    const provider = badHeader({ number: 1, timestamp: 1, hash: '0x12' });

    expect(await partFor(provider).paused(METHOD)).toEqual({ answered: false });
    expect(provider.calls).toEqual([]);
  });
});

describe('one passed block pins a composite of part calls', () => {
  it('runs three reads and a prepare at one block with no block read in total', async () => {
    const provider = answeringAll();
    const part = partFor(provider);

    await part.stateOf(PASSED);
    await part.paused(METHOD, PASSED);
    await part.moduleInfo(METHOD, PASSED);

    const call = await part.prepareCancelByOwner(ACTION, 1n, PASSED);

    expect(provider.blockTags).toEqual([]);
    expect(provider.calls).toHaveLength(5);
    expect(provider.calls.every((entry) => entry.block === PASSED.number)).toBe(true);
    expect(call.block).toEqual(PINNED);
  });
});
