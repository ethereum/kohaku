import {
  MIMC_MERKLE_TREE_LEVELS,
  MIMC_MERKLE_TREE_ZERO_VALUE,
  mimcMerkleTreeHash,
  type MerkleTree,
} from '@kohaku-eth/mimc-tree';

/**
 * The right edge of an append-only pool tree, as the pool contract keeps it:
 * per level, the last node with an even index (`filledSubtrees`), plus the leaf
 * count and root. Enough to append leaves without the leaves before them.
 */
export interface IMerkleFrontier {
  size: number;
  nodes: bigint[];
  root: bigint;
}

const hash = (left: bigint, right: bigint) => BigInt(mimcMerkleTreeHash(left.toString(), right.toString()));

let zerosCache: bigint[] | undefined;

/** The root of an empty subtree at each level, up to the whole tree's. */
const zeros = (): bigint[] => {
  if (!zerosCache) {
    zerosCache = [BigInt(MIMC_MERKLE_TREE_ZERO_VALUE)];

    for (let level = 1; level <= MIMC_MERKLE_TREE_LEVELS; level++) {
      zerosCache.push(hash(zerosCache[level - 1]!, zerosCache[level - 1]!));
    }
  }

  return zerosCache;
};

export const emptyFrontier = (): IMerkleFrontier => ({
  size: 0,
  nodes: zeros().slice(0, MIMC_MERKLE_TREE_LEVELS),
  root: zeros()[MIMC_MERKLE_TREE_LEVELS]!,
});

/** Appends `leaves` the way the pool contract's `_insert` does, one at a time. */
export const appendLeaves = (frontier: IMerkleFrontier, leaves: bigint[]): IMerkleFrontier => {
  const nodes = [...frontier.nodes];
  let { size, root } = frontier;

  for (const leaf of leaves) {
    let index = size;
    let node = leaf;

    for (let level = 0; level < MIMC_MERKLE_TREE_LEVELS; level++) {
      if (index % 2 === 0) {
        nodes[level] = node;
        node = hash(node, zeros()[level]!);
      } else {
        node = hash(nodes[level]!, node);
      }

      index = Math.floor(index / 2);
    }

    size++;
    root = node;
  }

  return { size, nodes, root };
};

/** The frontier of a tree built from all its leaves at once. */
export const frontierOf = (tree: MerkleTree): IMerkleFrontier => {
  const size = tree.layers[0]!.length;

  if (size === 0) return emptyFrontier();

  const nodes = Array.from({ length: MIMC_MERKLE_TREE_LEVELS }, (_, level) => {
    // The last node at this level, or its left sibling when it is a right child.
    const last = (size - 1) >> level;

    return BigInt(tree.layers[level]![last - (last % 2)]!);
  });

  return { size, nodes, root: BigInt(tree.root) };
};
