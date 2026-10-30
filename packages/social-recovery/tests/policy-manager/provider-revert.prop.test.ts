import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isProviderRevert } from '../../src/index';
import { TIMEOUT, run } from '../formats/arbitraries';

describe('isProviderRevert over arbitrary data', () => {
  it('accepts exactly the objects whose data is 0x and whole bytes of hex', () => {
    const hexDigit = fc.constantFrom(...'0123456789abcdefABCDEF'.split(''));
    const anyText = fc.oneof(fc.string(), fc.array(hexDigit).map((digits) => `0x${digits.join('')}`));

    run(fc.property(anyText, (data) => {
      const wholeBytes = data.startsWith('0x') && (data.length - 2) % 2 === 0 && /^[0-9a-fA-F]*$/.test(data.slice(2));

      expect(isProviderRevert({ data })).toBe(wholeBytes);
    }));
  }, TIMEOUT);
});
