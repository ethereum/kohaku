import { describe, expect, it } from 'vitest';

import { appendLeaves, emptyFrontier, frontierOf } from '../../src/utils/merkle-frontier';
import { buildTree } from '../../src/utils/merkle-tree/merkle-tree.util.node';

const leaves = (count: number) => Array.from({ length: count }, (_, index) => BigInt(index) * 7919n + 13n);

describe('merkle frontier', () => {
  it('starts from the root of an empty tree', async () => {
    expect(emptyFrontier().root).toBe(BigInt((await buildTree([])).root));
  });

  it.each([1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 33, 64, 65])('matches a full build when appending %i leaves', async (count) => {
    const all = leaves(count);
    const built = await buildTree(all);
    const appended = appendLeaves(emptyFrontier(), all);

    expect(appended.root).toBe(BigInt(built.root));
    expect(appended).toEqual(frontierOf(built));
  });

  it.each([[0, 5], [1, 1], [3, 6], [8, 9], [31, 2], [40, 25]])('resumes from a built prefix of %i leaves with %i more', async (prefix, more) => {
    const all = leaves(prefix + more);
    const resumed = appendLeaves(frontierOf(await buildTree(all.slice(0, prefix))), all.slice(prefix));

    expect(resumed.root).toBe(BigInt((await buildTree(all)).root));
    expect(resumed.size).toBe(prefix + more);
  });
});
