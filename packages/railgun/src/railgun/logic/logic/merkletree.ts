import {
  arrayToBigInt,
  bigIntToArray,
  arrayToByteLength,
} from "../global/bytes";
import { SNARK_SCALAR_FIELD } from "../global/constants";
import { hash } from "../global/crypto";

export interface MerkleProof {
  element: Uint8Array;
  elements: Uint8Array[];
  indices: number;
  root: Uint8Array;
}

class MerkleTree {
  treeNumber: number;
  depth: number;
  zeros: Uint8Array[];
  tree: Uint8Array[][];
  nullifiers: Uint8Array[] = [];

  // Track the highest leaf index we’ve ever set (−1 means “no leaves yet”)
  private maxLeafIndex: number = -1;

  constructor(
    treeNumber: number,
    depth: number,
    zeros: Uint8Array[],
    tree: Uint8Array[][]
  ) {
    this.treeNumber = treeNumber;
    this.depth = depth;
    this.zeros = zeros;
    this.tree = tree;
  }

  get root(): Uint8Array {
    // @ts-expect-error tree is defined
    return this.tree[this.depth][0];
  }

  get length(): number {
    // @ts-expect-error tree is defined
    return this.tree[0].length;
  }

  static hashLeftRight(
    left: Uint8Array,
    right: Uint8Array
  ): Promise<Uint8Array> {
    return hash.poseidon([
      arrayToByteLength(left, 32),
      arrayToByteLength(right, 32),
    ]);
  }

  static get zeroValue(): Uint8Array {
    const railgunHash = arrayToBigInt(
      hash.keccak256(new Uint8Array(Buffer.from("Railgun", "utf8")))
    );

    return bigIntToArray(railgunHash % SNARK_SCALAR_FIELD, 32);
  }

  static async getZeroValueLevels(depth: number): Promise<Uint8Array[]> {
    const levels: Uint8Array[] = [];

    levels.push(this.zeroValue);

    for (let level = 1; level < depth; level += 1) {
      levels.push(
        // @ts-expect-error levels is defined
        await MerkleTree.hashLeftRight(levels[level - 1], levels[level - 1])
      );
    }

    return levels;
  }

  static async createTree(treeNumber = 0, depth = 16): Promise<MerkleTree> {
    const zeros: Uint8Array[] = await MerkleTree.getZeroValueLevels(depth);
    // Build arrays for all levels [0..depth]
    const tree: Uint8Array[][] = Array.from({ length: depth + 1 }, () => []);

    // Default root = hash(zero, zero) at the top level
    tree[depth] = [
      // @ts-expect-error tree is defined
      await MerkleTree.hashLeftRight(zeros[depth - 1], zeros[depth - 1]),
    ];

    return new MerkleTree(treeNumber, depth, zeros, tree);
  }

  /**
   * Rebuilds only the portion of the sparse tree that’s actually used.
   * Also defaults BOTH children to zeros when missing to avoid undefined errors.
   */
  async rebuildSparseTree() {
    // No leaves inserted: reset upper levels to zero-root and bail.
    if (this.maxLeafIndex < 0) {
      for (let lvl = 1; lvl <= this.depth; lvl++) this.tree[lvl] = [];
      this.tree[this.depth] = [
        await MerkleTree.hashLeftRight(
          // @ts-expect-error tree is defined
          this.zeros[this.depth - 1],
          this.zeros[this.depth - 1]
        ),
      ];

      return;
    }

    // Width of the current level (how many leaves actually matter)
    let width = this.maxLeafIndex + 1;

    for (let level = 0; level < this.depth; level += 1) {
      const parents: Uint8Array[] = [];

      // Hash pairs up to the “used” width only
      for (let pos = 0; pos < width; pos += 2) {
        // @ts-expect-error tree is defined
        const left = this.tree[level][pos] ?? this.zeros[level];
        // @ts-expect-error tree is defined
        const right = this.tree[level][pos + 1] ?? this.zeros[level];

        // @ts-expect-error parents is defined
        parents.push(await MerkleTree.hashLeftRight(left, right));
      }
      this.tree[level + 1] = parents;
      width = Math.ceil(width / 2); // next level width
    }
  }

  insertLeaves(leaves: Uint8Array[], startPosition: number) {
    if (leaves.length === 0) return;

    leaves.forEach((leaf, index) => {
      // @ts-expect-error tree is defined
      this.tree[0][startPosition + index] = leaf;
    });

    // Track the highest populated index so rebuild doesn’t traverse the whole sparse array
    const last = startPosition + leaves.length - 1;

    if (last > this.maxLeafIndex) this.maxLeafIndex = last;

    // NOTE: rebuildSparseTree must be invoked manually after inserting leaves
  }

  generateProof(element: Uint8Array): MerkleProof {
    const elements: Uint8Array[] = [];
    // @ts-expect-error tree is defined
    const initialIndex = this.tree[0]
      .map(arrayToBigInt)
      .indexOf(arrayToBigInt(element));
    let index = initialIndex;

    if (index === -1) {
      throw new Error(
        `Couldn't find ${arrayToBigInt(element)} in the MerkleTree`
      );
    }

    for (let level = 0; level < this.depth; level += 1) {
      if (index % 2 === 0) {
        // @ts-expect-error tree is defined
        elements.push(this.tree[level][index + 1] ?? this.zeros[level]);
      } else {
        // @ts-expect-error tree is defined
        elements.push(this.tree[level][index - 1] ?? this.zeros[level]); // also default here
      }

      index = Math.floor(index / 2);
    }

    return { element, elements, indices: initialIndex, root: this.root };
  }

  static async validateProof(proof: MerkleProof): Promise<boolean> {
    const indices = proof.indices
      .toString(2)
      .padStart(proof.elements.length, "0")
      .split("")
      .reverse();

    let currentHash = proof.element;

    for (let i = 0; i < proof.elements.length; i += 1) {
      if (indices[i] === "0") {
        currentHash = await MerkleTree.hashLeftRight(
          currentHash,
          // @ts-expect-error proof.elements is defined
          proof.elements[i]
        );
      } else {
        currentHash = await MerkleTree.hashLeftRight(
          // @ts-expect-error proof.elements is defined
          proof.elements[i],
          currentHash
        );
      }
    }

    return arrayToBigInt(currentHash) === arrayToBigInt(proof.root);
  }
}

export { MerkleTree };
