import { poseidonT3 } from "@kohaku-eth/poseidon";
import { hashRange } from "./hash-range.ts";
import { defaultWorkerCount, parallelLevels } from "./parallel.ts";

export interface LeanIMTMerkleProof {
  root: bigint;
  leaf: bigint;
  index: number;
  siblings: bigint[];
}

export interface ParallelOptions {
  // Defaults to the number of logical CPUs, capped at 16.
  workers?: number;
  // URL of dist/worker.js ("@kohaku-eth/poseidon-lean-imt/worker.js"), for bundlers that
  // do not emit it on their own.
  workerUrl?: string | URL;
}

// @zk-kit/lean-imt LeanIMT over Poseidon T3.
export class PoseidonT3LeanIMT {
  // levels[0] holds the leaves, the last level holds [root].
  private levels: bigint[][] = [[]];
  private readonly positions = new Map<bigint, number>();

  constructor(leaves: bigint[] = []) {
    if (leaves.length > 0) this.insertMany(leaves);
  }

  // Same tree as new LeanIMT(leaves), hashed level by level on workers. Workers
  // always start (at most one per parent), even when the tree is too small to
  // gain from them.
  static async fromLeavesParallel(leaves: bigint[], options: ParallelOptions = {}): Promise<PoseidonT3LeanIMT> {
    const workers = options.workers ?? (await defaultWorkerCount());

    if (!Number.isInteger(workers) || workers < 1) {
      throw new Error(`workers must be a positive integer, got ${workers}`);
    }

    const tree = new PoseidonT3LeanIMT();

    if (leaves.length === 0) return tree;

    tree.levels = await parallelLevels(leaves, workers, options.workerUrl);
    tree.levels[0].forEach((leaf, i) => {
      if (!tree.positions.has(leaf)) tree.positions.set(leaf, i);
    });

    return tree;
  }

  // undefined on an empty tree.
  get root(): bigint {
    return this.levels[this.depth][0];
  }

  get depth(): number {
    return this.levels.length - 1;
  }

  get leaves(): bigint[] {
    return this.levels[0].slice();
  }

  get size(): number {
    return this.levels[0].length;
  }

  // First occurrence, like Array.indexOf.
  indexOf(leaf: bigint): number {
    return this.positions.get(leaf) ?? -1;
  }

  has(leaf: bigint): boolean {
    return this.positions.has(leaf);
  }

  insert(leaf: bigint): void {
    let index = this.size;

    if (!this.positions.has(leaf)) this.positions.set(leaf, index);

    if (this.depth < Math.ceil(Math.log2(index + 1))) this.levels.push([]);

    let node = leaf;

    for (let level = 0; level < this.depth; level++) {
      this.levels[level][index] = node;

      if (index & 1) node = poseidonT3(this.levels[level][index - 1], node);

      index >>= 1;
    }
    this.levels[this.depth] = [node];
  }

  insertMany(leaves: bigint[]): void {
    if (leaves.length === 0) throw new Error("There are no leaves to add");

    const leafLevel = this.levels[0];

    for (const leaf of leaves) {
      if (!this.positions.has(leaf)) this.positions.set(leaf, leafLevel.length);

      leafLevel.push(leaf);
    }
    while (this.depth < Math.ceil(Math.log2(this.size))) this.levels.push([]);

    // Parents from the one of the first touched node up are recomputed.
    let start = (this.size - leaves.length) >> 1;

    for (let level = 0; level < this.depth; level++) {
      const prev = this.levels[level];
      const next = this.levels[level + 1];
      const parents = hashRange(prev, start, Math.ceil(prev.length / 2));

      for (let i = 0; i < parents.length; i++) next[start + i] = parents[i];

      start >>= 1;
    }
  }

  // Levels without a sibling are skipped; index holds only the path bits of the
  // levels that have one.
  generateProof(index: number): LeanIMTMerkleProof {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new Error(`The leaf at index '${index}' does not exist in this tree`);
    }

    const leaf = this.levels[0][index];
    const siblings: bigint[] = [];
    let pathIndex = 0;
    let pos = index;

    for (let level = 0; level < this.depth; level++) {
      const isRight = pos & 1;
      const sibling = isRight ? pos - 1 : pos + 1;

      if (sibling < this.levels[level].length) {
        if (isRight) pathIndex += 2 ** siblings.length;

        siblings.push(this.levels[level][sibling]);
      }

      pos >>= 1;
    }

    return { root: this.root, leaf, index: pathIndex, siblings };
  }

  verifyProof(proof: LeanIMTMerkleProof): boolean {
    return PoseidonT3LeanIMT.verifyProof(proof);
  }

  // Bit i of index set: siblings[i] is on the left.
  static verifyProof(proof: LeanIMTMerkleProof): boolean {
    const { root, leaf, index, siblings } = proof;
    let node = leaf;

    for (let i = 0; i < siblings.length; i++) {
      const isRight = Math.floor(index / 2 ** i) % 2 === 1;

      node = isRight ? poseidonT3(siblings[i], node) : poseidonT3(node, siblings[i]);
    }

    return node === root;
  }
}
