import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertUintNumber, checkedBlock } from '../formats/guards';
import { NAMED_BLOCK_TAGS, type BlockHeader, type BlockTag, type IProvider } from '../interfaces';
import type { PinnedHeader } from '../types';

/** The header's number, timestamp and lower-cased hash, refusing anything but non-negative safe integers and a 32-byte hash. */
export function checkedHeader(value: unknown, name: string): BlockHeader {
  const { number, hash } = checkedBlock(value, name);
  const { timestamp } = value as Partial<Record<keyof BlockHeader, unknown>>;

  assertUintNumber(timestamp, FORMATS_SAFE_INTEGER_BITS, `${name}.timestamp`);

  return { number, timestamp, hash };
}

/** Refuses a tag that is neither a named block tag nor a block number, a non-negative safe integer. */
function assertBlockTag(tag: unknown): asserts tag is BlockTag {
  if (typeof tag === 'number') {
    if (!Number.isSafeInteger(tag) || tag < 0) throw new TypeError('tag must be a non-negative safe integer block number');

    return;
  }

  if (!(NAMED_BLOCK_TAGS as readonly unknown[]).includes(tag)) throw new TypeError(`tag must be one of ${NAMED_BLOCK_TAGS.join(', ')}`);
}

/**
 * The block the tag names at this moment, read once, keeping its timestamp beside the block every read is pinned to.
 * A tag that is neither a named block tag nor a block number throws a `TypeError` before the provider is called.
 */
export async function pinBlockHeader(provider: IProvider, tag: BlockTag): Promise<PinnedHeader> {
  assertBlockTag(tag);

  const header = checkedHeader(await provider.block(tag), 'block header');

  return { header, block: { number: header.number, hash: header.hash } };
}
