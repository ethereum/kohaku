// Differential tests against @zk-kit/lean-imt, both over poseidonT3.

import { describe, expect, it } from 'vitest';
import { LeanIMT as ZkLeanIMT } from '@zk-kit/lean-imt';
import { poseidonT3 } from '@kohaku-eth/poseidon';
import { PoseidonT3LeanIMT as LeanIMT } from '../src/index.ts';

const p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

const range = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => BigInt(i + 1 + offset));

function expectSameTree(ours: LeanIMT, theirs: ZkLeanIMT<bigint>): void {
  expect(ours.root).toBe(theirs.root);
  expect(ours.depth).toBe(theirs.depth);
  expect(ours.size).toBe(theirs.size);
}

describe('LeanIMT', () => {
  it('matches root, depth and proofs for sizes 1..64', () => {
    for (let n = 1; n <= 64; n++) {
      const leaves = range(n);
      const ours = new LeanIMT(leaves);
      const theirs = new ZkLeanIMT(poseidonT3, leaves);

      expectSameTree(ours, theirs);

      for (let i = 0; i < n; i++) {
        expect(ours.generateProof(i)).toEqual(theirs.generateProof(i));
      }

      // Proofs equal zk-kit's, so verifying the ends is enough.
      for (const i of [0, n - 1]) {
        const proof = ours.generateProof(i);

        expect(ours.verifyProof(proof)).toBe(true);
        expect(theirs.verifyProof(proof)).toBe(true);
      }
    }
  });

  it('matches large trees', () => {
    for (const n of [1024, 1025]) {
      const leaves = range(n);
      const ours = new LeanIMT(leaves);
      const theirs = new ZkLeanIMT(poseidonT3, leaves);

      expectSameTree(ours, theirs);

      for (const i of [0, 1, n >> 1, n - 2, n - 1]) {
        expect(ours.generateProof(i)).toEqual(theirs.generateProof(i));
      }
    }
  });

  it('grows with insert and insertMany like a full build', () => {
    const ours = new LeanIMT();
    const theirs = new ZkLeanIMT(poseidonT3);

    expect(ours.root).toBeUndefined();
    let next = 0;

    // Chunk sizes cover odd/even starts and crossing powers of two.
    for (const k of [1, 1, 3, 1, 2, 7, 1, 16, 5, 1, 1, 33, 64, 2, 1, 100]) {
      const chunk = range(k, next);

      next += k;

      if (k === 1) {
        ours.insert(chunk[0]);
        theirs.insert(chunk[0]);
      } else {
        ours.insertMany(chunk);
        theirs.insertMany(chunk);
      }

      expectSameTree(ours, theirs);
      expect(ours.root).toBe(new ZkLeanIMT(poseidonT3, range(next)).root);

      for (let i = 0; i < next; i++) {
        expect(ours.generateProof(i)).toEqual(theirs.generateProof(i));
      }
    }
  });

  it('indexOf and has, with duplicates and absent leaves', () => {
    const leaves = [5n, 7n, 5n, 9n, 7n];
    const ours = new LeanIMT(leaves.slice(0, 3));
    const theirs = new ZkLeanIMT(poseidonT3, leaves.slice(0, 3));

    ours.insert(leaves[3]);
    theirs.insert(leaves[3]);
    ours.insertMany(leaves.slice(4));
    theirs.insertMany(leaves.slice(4));

    for (const leaf of [5n, 7n, 9n, 42n]) {
      expect(ours.indexOf(leaf)).toBe(theirs.indexOf(leaf));
      expect(ours.has(leaf)).toBe(theirs.has(leaf));
    }
    expect(ours.leaves).toEqual(theirs.leaves);
  });

  it('throws the same errors', () => {
    const ours = new LeanIMT(range(4));
    const theirs = new ZkLeanIMT(poseidonT3, range(4));
    const calls = [
      (t: LeanIMT | ZkLeanIMT<bigint>) => t.insertMany([]),
      (t: LeanIMT | ZkLeanIMT<bigint>) => t.generateProof(4),
      (t: LeanIMT | ZkLeanIMT<bigint>) => t.generateProof(-1),
    ];

    for (const f of calls) {
      let expected: Error | undefined;

      try { f(theirs); } catch (e) { expected = e as Error; }

      expect(() => f(ours)).toThrow(expected!.message);
    }
  });

  it('rejects tampered proofs', () => {
    const ours = new LeanIMT(range(10));
    const proof = ours.generateProof(3);

    expect(ours.verifyProof({ ...proof, leaf: proof.leaf + 1n })).toBe(false);
    expect(LeanIMT.verifyProof({ ...proof, index: proof.index ^ 1 })).toBe(false);
  });
});

describe('LeanIMT.fromLeavesParallel', () => {
  it('builds the same tree as the sync build', async () => {
    // More workers than leaves, an odd last leaf, a power of two; 3 workers gives
    // uneven runs.
    for (const n of [1, 3, 100, 1025]) {
      const leaves = range(n);
      const sync = new LeanIMT(leaves);

      for (const workers of [1, 3, 4]) {
        const ours = await LeanIMT.fromLeavesParallel(leaves, { workers });

        expect(ours.root).toBe(sync.root);
        expect(ours.depth).toBe(sync.depth);
        expect(ours.size).toBe(sync.size);

        // Proofs need no hashing, so every node is checked through them.
        for (let i = 0; i < n; i++) {
          expect(ours.generateProof(i)).toEqual(sync.generateProof(i));
        }
      }
    }
  });

  it('matches zk-kit and keeps working incrementally', async () => {
    // Duplicates and leaves >= p, which the hash reduces.
    const leaves = range(1000 + 7);

    leaves[100] = leaves[3];
    leaves[200] = p + 5n;
    leaves[300] = (1n << 300n) + 1n;
    const ours = await LeanIMT.fromLeavesParallel(leaves, { workers: 4 });
    const theirs = new ZkLeanIMT(poseidonT3, leaves);

    expectSameTree(ours, theirs);
    expect(ours.leaves).toEqual(theirs.leaves);

    for (const leaf of [leaves[3], leaves[200], leaves[300], 42n, -1n]) {
      expect(ours.indexOf(leaf)).toBe(theirs.indexOf(leaf));
    }

    ours.insert(99_999n);
    theirs.insert(99_999n);
    ours.insertMany(range(50, 100_000));
    theirs.insertMany(range(50, 100_000));
    expectSameTree(ours, theirs);

    for (const i of [0, 3, 100, 200, 300, ours.size - 1]) {
      expect(ours.generateProof(i)).toEqual(theirs.generateProof(i));
    }
  });

  it('handles edge cases', async () => {
    expect((await LeanIMT.fromLeavesParallel([], { workers: 4 })).size).toBe(0);
    expect((await LeanIMT.fromLeavesParallel(range(5))).root).toBe(new LeanIMT(range(5)).root);

    for (const workers of [0, -1, 1.5]) {
      await expect(LeanIMT.fromLeavesParallel(range(10), { workers })).rejects.toThrow(/workers must be a positive integer/);
    }
    const negative = range(100);

    negative[10] = -1n;
    await expect(LeanIMT.fromLeavesParallel(negative, { workers: 2 })).rejects.toThrow(RangeError);
  });
});
