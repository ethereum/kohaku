import { describe, expect, it } from 'vitest';
import { checkedHeader, pinBlockHeader, type BlockHeader, type PinnedHeader } from '../../src/index';
import { HEADER, providerDouble } from './support';

const MIXED_HASH = '0x5A5a5A5a5a5A5a5A5a5a5a5A5a5a5a5A5A5a5a5A5a5A5a5a5A5a5A5a5a5A5A5a' as const;

describe('pinBlockHeader', () => {
  it.each(['latest', 'finalized', 12_345] as const)('reads block(%s) exactly once and no other provider member', async (tag) => {
    const double = providerDouble();

    await pinBlockHeader(double.provider, tag);
    expect(double.blockTags).toEqual([tag]);
    expect(double.calls).toEqual([]);
    expect(double.others).toEqual([]);
  });

  it('returns the header with its timestamp and the pinned number and hash of the same block', async () => {
    const pinned: PinnedHeader = await pinBlockHeader(providerDouble().provider, 'latest');

    expect(pinned.header).toStrictEqual(HEADER);
    expect(pinned.block).toStrictEqual({ number: HEADER.number, hash: HEADER.hash });
  });

  it('lower-cases the hash in both the header and the pinned block', async () => {
    const double = providerDouble(undefined, async () => ({ ...HEADER, hash: MIXED_HASH }));
    const pinned = await pinBlockHeader(double.provider, 'latest');

    expect(pinned.header.hash).toBe(MIXED_HASH.toLowerCase());
    expect(pinned.block.hash).toBe(MIXED_HASH.toLowerCase());
  });

  it('keeps the header members only, dropping anything else the provider answered', async () => {
    const double = providerDouble(undefined, async () => ({ ...HEADER, extra: 'ignored' }));
    const pinned = await pinBlockHeader(double.provider, 'latest');

    expect(pinned.header).toStrictEqual(HEADER);
  });

  it('accepts block zero and timestamp zero', async () => {
    const header: BlockHeader = { number: 0, timestamp: 0, hash: HEADER.hash };
    const pinned = await pinBlockHeader(providerDouble(undefined, async () => header).provider, 'latest');

    expect(pinned.header).toStrictEqual(header);
    expect(pinned.block).toStrictEqual({ number: 0, hash: HEADER.hash });
  });

  it('refuses a malformed header the provider answered', async () => {
    const double = providerDouble(undefined, async () => ({ ...HEADER, timestamp: -1 }));

    await expect(pinBlockHeader(double.provider, 'latest')).rejects.toThrow(RangeError);
  });

  it('propagates a provider rejection as the same value', async () => {
    const failure = new Error('transport down');
    const double = providerDouble(undefined, async () => {
      throw failure;
    });

    await expect(pinBlockHeader(double.provider, 'latest')).rejects.toBe(failure);
  });
});

describe('checkedHeader', () => {
  it('returns the header with a lower-cased hash', () => {
    expect(checkedHeader({ ...HEADER, hash: MIXED_HASH }, 'header')).toStrictEqual({ ...HEADER, hash: MIXED_HASH.toLowerCase() });
  });

  it('accepts the largest safe integers for number and timestamp', () => {
    const header = { number: Number.MAX_SAFE_INTEGER, timestamp: Number.MAX_SAFE_INTEGER, hash: HEADER.hash };

    expect(checkedHeader(header, 'header')).toStrictEqual(header);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'latest'],
    ['a number', 12],
  ])('refuses %s with a TypeError', (_, value) => {
    expect(() => checkedHeader(value, 'header')).toThrow(TypeError);
  });

  it.each([
    ['number', 'missing', { timestamp: HEADER.timestamp, hash: HEADER.hash }, TypeError],
    ['number', 'fractional', { ...HEADER, number: 1.5 }, TypeError],
    ['number', 'a string', { ...HEADER, number: '12' }, TypeError],
    ['number', 'a bigint', { ...HEADER, number: 12n }, TypeError],
    ['number', 'negative', { ...HEADER, number: -1 }, RangeError],
    ['number', '2^53', { ...HEADER, number: 2 ** 53 }, RangeError],
    ['timestamp', 'missing', { number: HEADER.number, hash: HEADER.hash }, TypeError],
    ['timestamp', 'fractional', { ...HEADER, timestamp: 1.25 }, TypeError],
    ['timestamp', 'NaN', { ...HEADER, timestamp: Number.NaN }, TypeError],
    ['timestamp', 'a string', { ...HEADER, timestamp: '1760000000' }, TypeError],
    ['timestamp', 'negative', { ...HEADER, timestamp: -1 }, RangeError],
    ['timestamp', '2^53', { ...HEADER, timestamp: 2 ** 53 }, RangeError],
    ['timestamp', 'infinite', { ...HEADER, timestamp: Number.POSITIVE_INFINITY }, TypeError],
  ] as const)('refuses a %s that is %s', (_, __, value, kind) => {
    expect(() => checkedHeader(value, 'header')).toThrow(kind);
  });

  it.each([
    ['missing', { number: HEADER.number, timestamp: HEADER.timestamp }],
    ['short', { ...HEADER, hash: '0x1234' }],
    ['long', { ...HEADER, hash: `${HEADER.hash}00` }],
    ['unprefixed', { ...HEADER, hash: HEADER.hash.slice(2) }],
    ['not hex', { ...HEADER, hash: `0x${'zz'.repeat(32)}` }],
    ['a number', { ...HEADER, hash: 5 }],
  ])('refuses a hash that is %s', (_, value) => {
    expect(() => checkedHeader(value, 'header')).toThrow(TypeError);
  });

  it('names the argument in its message', () => {
    expect(() => checkedHeader({ ...HEADER, timestamp: -1 }, 'pinned')).toThrow(/pinned/);
  });
});
