import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeRevert, type Hex } from '../../src/index';
import { TIMEOUT, run } from '../formats/arbitraries';
import { expectedValue, KIT_ROWS, revertData, type ArgumentValue, type ErrorRow } from './rows';

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

const anyData = fc.uint8Array({ maxLength: 300 }).map(toHex);

const valueOf = (type: string): fc.Arbitrary<ArgumentValue> => {
  if (type === 'address') return fc.uint8Array({ minLength: 20, maxLength: 20 }).map(toHex);

  if (type === 'bytes32') return fc.uint8Array({ minLength: 32, maxLength: 32 }).map(toHex);

  if (type === 'bytes') return fc.uint8Array({ maxLength: 100 }).map(toHex);

  return fc.bigInt({ min: 0n, max: (1n << BigInt(Number(type.slice('uint'.length)))) - 1n });
};

const rowWithValues: fc.Arbitrary<{ entry: ErrorRow; values: ArgumentValue[] }> = fc
  .constantFrom(...KIT_ROWS)
  .chain((entry) => fc.tuple(...entry.inputs.map((input) => valueOf(input.type))).map((values) => ({ entry, values })));

describe('decodeRevert over arbitrary data', () => {
  it('never throws and answers known or unknown, echoing the bytes when unknown', () => {
    run(fc.property(anyData, (data) => {
      const result = decodeRevert(data);

      if (!result.known) expect(result.data.toLowerCase()).toBe(data);

      if (data.length < 10) expect(result).toEqual({ known: false, data });
    }));
  }, TIMEOUT);

  it('never throws on arbitrary bytes after a declared selector', () => {
    run(fc.property(fc.constantFrom(...KIT_ROWS), anyData, (entry, tail) => {
      const result = decodeRevert(`${entry.selector}${tail.slice(2)}`);

      expect(result.selector).toBe(entry.selector);

      if (result.known) expect(result.name).toBe(entry.name);
    }));
  }, TIMEOUT);

  it('names every declared error with the very values encoded into it', () => {
    run(fc.property(rowWithValues, ({ entry, values }) => {
      const args = Object.fromEntries(entry.inputs.map((input, at) => [input.name, expectedValue(input.type, values[at] ?? 0n)]));

      expect(decodeRevert(revertData(entry, values))).toEqual({
        known: true,
        source: entry.source,
        name: entry.name,
        selector: entry.selector,
        args,
      });
    }));
  }, TIMEOUT);
});
