import { describe, expect, it } from 'vitest';
import { decodeRevert, type Hex } from '../../src/index';
import { KIT_ROWS, revertData, rowNamed, samplesFor } from './rows';

describe('decodeRevert on data it cannot name', () => {
  it('returns the unknown result with the selector and the raw bytes for an undeclared selector', () => {
    const data: Hex = '0x12345678000000000000000000000000000000000000000000000000000000000000002a';
    const result = decodeRevert(data);

    expect(result).toEqual({ known: false, selector: '0x12345678', data });
  });

  it('returns the unknown result for a bare undeclared selector', () => {
    expect(decodeRevert('0xcafebabe')).toEqual({ known: false, selector: '0xcafebabe', data: '0xcafebabe' });
  });

  it.each(['0x', '0x01', '0x0102', '0x010203'] as const)('returns no selector for %s, shorter than four bytes', (data) => {
    const result = decodeRevert(data);

    expect(result).toEqual({ known: false, data });
    expect('selector' in result).toBe(false);
  });

  it.each(KIT_ROWS.filter((entry) => entry.inputs.length > 0).map((entry) => [entry.name, entry] as const))(
    'returns the unknown result for %s with its arguments cut short',
    (_name, entry) => {
      const full = revertData(entry, samplesFor(entry, 9));
      const truncated = full.slice(0, full.length - 2) as Hex;

      for (const data of [entry.selector, truncated]) {
        const result = decodeRevert(data);

        expect(result).toEqual({ known: false, selector: entry.selector, data });
      }
    },
  );

  it('returns the unknown result when an address argument carries bits above its twenty bytes', () => {
    const noSetup = rowNamed('PolicyManager_NoSetup');

    const dirty: Hex = `${noSetup.selector}${'ff'.repeat(12)}${'11'.repeat(20)}${'00'.repeat(12)}${'22'.repeat(20)}`;

    expect(() => decodeRevert(dirty)).not.toThrow();
    expect(decodeRevert(dirty)).toMatchObject({ known: false, selector: noSetup.selector });
  });

  it('returns the unknown result for a bytes argument whose offset points past the data', () => {
    const malformed = rowNamed('RecoveryAction_MalformedHandover');

    const data: Hex = `${malformed.selector}${'00'.repeat(31)}ff${'00'.repeat(32)}`;

    expect(decodeRevert(data)).toMatchObject({ known: false, selector: malformed.selector });
  });

  it.each([
    ['NoSetup(address,address)', '0x4ed09422'],
    ['ReservedAuthority(address)', '0x58c9302f'],
    ['NotConsumable(address,uint8,uint48,bytes32)', '0x6c5e8cd1'],
  ] as const)('returns the unknown result for the unprefixed %s selector %s the contracts do not raise', (_signature, selector) => {
    const data: Hex = `${selector}${'00'.repeat(12)}${'11'.repeat(20)}${'00'.repeat(32)}${'00'.repeat(32)}${'00'.repeat(32)}`;

    expect(decodeRevert(data)).toEqual({ known: false, selector, data });
  });

  it.each(['0x123', 'not hex', '0xzzzzzzzz', ''])('never throws on input %j that is not even hex bytes', (data) => {
    expect(() => decodeRevert(data as Hex)).not.toThrow();
    expect(decodeRevert(data as Hex)).toEqual({ known: false, data });
  });
});

describe('decodeRevert is pure', () => {
  it('decodes the same bytes the same way twice and leaves the input string as it was', () => {
    for (const entry of KIT_ROWS) {
      const data = revertData(entry, samplesFor(entry, 2));
      const copy = `${data}`;

      expect(decodeRevert(data)).toEqual(decodeRevert(data));
      expect(data).toBe(copy);
    }
  });

  it('decodes an upper-case spelling of the same bytes to the same named error', () => {
    for (const entry of KIT_ROWS) {
      const data = revertData(entry, samplesFor(entry, 4));
      const upper = `0x${data.slice(2).toUpperCase()}` as Hex;
      const result = decodeRevert(upper);

      expect(result).toEqual(decodeRevert(data));
    }
  });
});
