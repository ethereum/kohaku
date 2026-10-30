import { describe, expect, it } from 'vitest';
import { decodeRevert, type Hex } from '../../src/index';
import { ERROR_STRING_SELECTOR } from './rows';

const word = (value: number): string => value.toString(16).padStart(64, '0');

/** `Error(string)` revert data over the given raw message bytes, canonically padded unless a tail is given. */
const errorWithBytes = (bytesHex: string, tail?: string): Hex => {
  const length = bytesHex.length / 2;
  const padded = tail ?? bytesHex.padEnd(Math.ceil(length / 32) * 64, '0');

  return `${ERROR_STRING_SELECTOR}${word(0x20)}${word(length)}${padded}` as Hex;
};

describe('decodeRevert reads Error(string) at the byte level', () => {
  it('names a canonical Error(string) whose message bytes are not valid UTF-8', () => {
    const result = decodeRevert(errorWithBytes('fffe0041'));

    expect(result).toMatchObject({ known: true, source: 'language', name: 'Error', selector: ERROR_STRING_SELECTOR });
    expect(result.known && Object.keys(result.args)).toEqual(['message']);
    expect(result.known && typeof result.args['message']).toBe('string');
  });

  it('still decodes a valid UTF-8 message to its exact text', () => {
    const text = Buffer.from('déjà vu ✓', 'utf8').toString('hex');

    expect(decodeRevert(errorWithBytes(text))).toMatchObject({ known: true, args: { message: 'déjà vu ✓' } });
  });

  it('names a canonical Error(string) that opens with a byte-order mark, the mark dropped from its text', () => {
    expect(decodeRevert(errorWithBytes('efbbbf41'))).toEqual({
      known: true,
      source: 'language',
      name: 'Error',
      selector: ERROR_STRING_SELECTOR,
      args: { message: 'A' },
    });
  });

  it('keeps a message with a nonzero byte in its padding unknown', () => {
    const data = errorWithBytes('fffe0041', `fffe0041${'0'.repeat(54)}01`);

    expect(decodeRevert(data)).toEqual({ known: false, selector: ERROR_STRING_SELECTOR, data });
  });
});
