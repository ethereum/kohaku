import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkRange } from '../../src/event-manager/chunks';

const WIDTH = fc.integer({ min: 1, max: 5000 });

describe('chunkRange: the empty window', () => {
  it.each([1, 2, 1000, Number.MAX_SAFE_INTEGER])('from %i to the block before it is no chunk', (block) => {
    expect(chunkRange({ from: block, to: block - 1 }, 10)).toEqual([]);
  });

  it('from any block n >= 1 to n - 1 is no chunk, whatever the width', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), WIDTH, (block, width) => {
        expect(chunkRange({ from: block, to: block - 1 }, width)).toEqual([]);
      }),
    );
  });

  it('from 0 to -1 is refused, since -1 is not a block', () => {
    expect(() => chunkRange({ from: 0, to: -1 }, 10)).toThrow(RangeError);
  });

  it('from any block n to n - 2 is still refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), WIDTH, (block, width) => {
        expect(() => chunkRange({ from: block, to: block - 2 }, width)).toThrow(RangeError);
      }),
    );
  });
});
