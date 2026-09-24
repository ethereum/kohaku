import type { BlockRange } from '../interfaces';

const isBlock = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** The chunk width, refused with a `RangeError` unless it is a positive whole number of blocks. */
export const checkChunkWidth = (width: number): number => {
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new RangeError(`The log chunk width must be a positive whole number of blocks, got ${width}.`);
  }

  return width;
};

/**
 * Consecutive chunks of at most `width` blocks covering the range, both bounds inclusive.
 * A range whose first block is one past its last is empty and yields no chunk.
 * Throws a `RangeError` when the bounds are not block numbers in order.
 */
export const chunkRange = (range: BlockRange, width: number): readonly BlockRange[] => {
  if (!isBlock(range.from) || !isBlock(range.to) || range.from > range.to + 1) {
    throw new RangeError(`The block range ${range.from}-${range.to} is not a first and a last block in order.`);
  }

  const chunks: BlockRange[] = [];

  for (let from = range.from; from <= range.to; from += width) {
    chunks.push({ from, to: Math.min(from + width - 1, range.to) });
  }

  return chunks;
};
