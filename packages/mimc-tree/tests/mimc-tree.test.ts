import { describe, expect, it } from 'vitest';
import { MerkleTree } from 'fixed-merkle-tree';
import {
  MIMC_MERKLE_TREE_LEVELS,
  MIMC_MERKLE_TREE_ZERO_VALUE,
  computeMimcMerkleTreeRoot,
  createMimcMerkleTree,
  createMimcMerkleTreeNodejsParallel,
  generateMimcMerkleProof,
  mimcMerkleTreeHash,
} from '../src/index.ts';

const LEAF_COUNT = 150;

function makeLeaves(count: number): bigint[] {
  const leaves: bigint[] = [];

  for (let i = 1; i <= count; i++) leaves.push(BigInt(i));

  return leaves;
}

const TEST_LEAVES = makeLeaves(LEAF_COUNT);

function makeRefTree(leaves: bigint[]): MerkleTree {
  return new MerkleTree(MIMC_MERKLE_TREE_LEVELS, leaves.map(String), {
    hashFunction: mimcMerkleTreeHash,
    zeroElement: MIMC_MERKLE_TREE_ZERO_VALUE,
  });
}

const refTree = makeRefTree(TEST_LEAVES);

describe('createMimcMerkleTree', () => {
  it('empty tree root equals reference MerkleTree root', () => {
    const refEmptyTree = makeRefTree([]);
    const mimcTree = createMimcMerkleTree([]);

    expect(mimcTree.root).toBe(refEmptyTree.root);
  });

  it('root equals reference MerkleTree root for 150 leaves', () => {
    const mimcTree = createMimcMerkleTree(TEST_LEAVES);

    expect(mimcTree.root).toBe(refTree.root);
  });

  it('leaves as bigint and leaves as string produce the same root', () => {
    const asBigInt = createMimcMerkleTree(TEST_LEAVES);
    const asString = createMimcMerkleTree(TEST_LEAVES.map(String));

    expect(asBigInt.root).toBe(asString.root);
  });

  it('levels option changes tree capacity', () => {
    const tree = createMimcMerkleTree([], { levels: 5 });

    expect(tree.capacity).toBe(2 ** 5);
  });

  it('throws when leaves exceed capacity', () => {
    const levels = 3;
    const tooMany = makeLeaves(2 ** levels + 1);

    expect(() => createMimcMerkleTree(tooMany, { levels })).toThrow('Tree is full');
  });
});

describe('computeMimcMerkleTreeRoot', () => {
  it('equals BigInt(tree.root) for 150 leaves', () => {
    const expected = BigInt(refTree.root);

    expect(computeMimcMerkleTreeRoot(TEST_LEAVES)).toBe(expected);
  });

  it('equals BigInt(tree.root) for an empty leaf set', () => {
    const expected = BigInt(makeRefTree([]).root);

    expect(computeMimcMerkleTreeRoot([])).toBe(expected);
  });
});

describe('generateMimcMerkleProof — from array', () => {
  it('proof root matches tree root', () => {
    const tree = createMimcMerkleTree(TEST_LEAVES);
    const proof = generateMimcMerkleProof(TEST_LEAVES, TEST_LEAVES[0]!);

    expect(proof.root).toBe(BigInt(tree.root));
  });

  it('proof index equals leaf position', () => {
    const targetIndex = 42;
    const proof = generateMimcMerkleProof(TEST_LEAVES, TEST_LEAVES[targetIndex]!);

    expect(proof.index).toBe(targetIndex);
  });

  it('siblings match fixed-merkle-tree pathElements', () => {
    const leaf = TEST_LEAVES[10]!;
    const refProof = refTree.proof(String(leaf));
    const mimcProof = generateMimcMerkleProof(TEST_LEAVES, leaf);

    expect(mimcProof.siblings).toEqual(refProof.pathElements.map(BigInt));
  });

  it('pathIndices match fixed-merkle-tree pathIndices', () => {
    const leaf = TEST_LEAVES[10]!;
    const refProof = refTree.proof(String(leaf));
    const mimcProof = generateMimcMerkleProof(TEST_LEAVES, leaf);

    expect(mimcProof.pathIndices).toEqual(refProof.pathIndices);
  });

  it('throws when leaf is not in the tree', () => {
    expect(() => generateMimcMerkleProof(TEST_LEAVES, 99999n)).toThrow('Leaf not found');
  });
});

describe('generateMimcMerkleProof — from tree instance', () => {
  it('gives the same result as calling with the leaves array', () => {
    const tree = createMimcMerkleTree(TEST_LEAVES);
    const leaf = TEST_LEAVES[7]!;
    const fromArray = generateMimcMerkleProof(TEST_LEAVES, leaf);
    const fromTree = generateMimcMerkleProof(tree, leaf);

    expect(fromTree).toEqual(fromArray);
  });
});

describe('createMimcMerkleTreeNodejsParallel', () => {
  it('root matches single-threaded result for 150 leaves', async () => {
    const syncRoot = createMimcMerkleTree(TEST_LEAVES).root;
    const parallelTree = await createMimcMerkleTreeNodejsParallel(TEST_LEAVES);

    expect(parallelTree.root).toBe(syncRoot);
  });
});
