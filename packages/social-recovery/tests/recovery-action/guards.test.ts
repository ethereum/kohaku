import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/index';
import { checkedBlock, lowerHex } from '../../src/formats/guards';

const HASH: Hex = `0x${'d4'.repeat(32)}`;

describe('lowerHex', () => {
  it.each([
    ['0x', '0x'],
    ['0xABCDEF', '0xabcdef'],
    ['0xabcdef', '0xabcdef'],
    ['0xAbCd01', '0xabcd01'],
  ] as const)('lower-cases %s to %s', (value, expected) => {
    expect(lowerHex(value)).toBe(expected);
  });

  it('leaves every digit and the length as they are', () => {
    const value: Hex = `0x0123456789ABCDEF${'F'.repeat(48)}`;

    expect(lowerHex(value)).toHaveLength(value.length);
    expect(lowerHex(value)).toBe(`0x0123456789abcdef${'f'.repeat(48)}`);
  });
});

describe('checkedBlock', () => {
  it('returns the number and the lower-cased hash', () => {
    expect(checkedBlock({ number: 12, hash: `0x${'D4'.repeat(32)}` }, 'block')).toStrictEqual({ number: 12, hash: HASH });
  });

  it('accepts the edges of the number range', () => {
    expect(checkedBlock({ number: 0, hash: HASH }, 'block').number).toBe(0);
    expect(checkedBlock({ number: Number.MAX_SAFE_INTEGER, hash: HASH }, 'block').number).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('copies only the number and the hash from a header', () => {
    expect(checkedBlock({ number: 3, hash: HASH, timestamp: 9, extra: 'x' }, 'block header')).toStrictEqual({ number: 3, hash: HASH });
  });

  it.each([
    ['null', null, TypeError, /^x must be an object/],
    ['undefined', undefined, TypeError, /^x must be an object/],
    ['a string', HASH, TypeError, /^x must be an object/],
    ['a missing number', { hash: HASH }, TypeError, /^x\.number /],
    ['a string number', { number: '1', hash: HASH }, TypeError, /^x\.number /],
    ['a bigint number', { number: 1n, hash: HASH }, TypeError, /^x\.number /],
    ['a fractional number', { number: 0.5, hash: HASH }, TypeError, /^x\.number /],
    ['NaN', { number: Number.NaN, hash: HASH }, TypeError, /^x\.number /],
    ['a negative number', { number: -1, hash: HASH }, RangeError, /^x\.number /],
    ['an unsafe number', { number: 2 ** 53, hash: HASH }, RangeError, /^x\.number /],
    ['a missing hash', { number: 1 }, TypeError, /^x\.hash /],
    ['a 31-byte hash', { number: 1, hash: `0x${'d4'.repeat(31)}` }, TypeError, /^x\.hash /],
    ['a 33-byte hash', { number: 1, hash: `0x${'d4'.repeat(33)}` }, TypeError, /^x\.hash /],
    ['a non-hex hash', { number: 1, hash: `0x${'g4'.repeat(32)}` }, TypeError, /^x\.hash /],
    ['an unprefixed hash', { number: 1, hash: 'd4'.repeat(32) }, TypeError, /^x\.hash /],
  ] as const)('refuses %s with the class and the field named', (_label, value, kind, message) => {
    expect(() => checkedBlock(value, 'x')).toThrow(kind);
    expect(() => checkedBlock(value, 'x')).toThrow(message);
  });
});
