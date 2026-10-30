/* global process, console */
import { LeanIMT as ZkLeanIMT } from '@zk-kit/lean-imt';
import { poseidonT3 } from '@kohaku-eth/poseidon';
import { PoseidonT3LeanIMT as LeanIMT } from '../dist/index.js';

const cases = [
  { label: '1k tree create', size: 1_000 },
  { label: '10k tree create', size: 10_000 },
  { label: '100k tree create', size: 100_000 },
].map(({ label, size }) => ({
  label,
  leaves: Array.from({ length: size }, (_, index) => BigInt(index + 1)),
}));

const variants = [
  { label: 'LeanIMT', create: (leaves) => new LeanIMT(leaves) },
  { label: 'LeanIMT.fromLeavesParallel', create: (leaves) => LeanIMT.fromLeavesParallel(leaves) },
  // What privacy-pools used before: the same hash, so this compares the trees.
  { label: '@zk-kit/lean-imt (poseidonT3)', create: (leaves) => new ZkLeanIMT(poseidonT3, leaves) },
];

for (const { label, leaves } of cases) {
  let expected;

  for (const variant of variants) {
    const start = process.hrtime.bigint();
    const tree = await variant.create(leaves);
    const diff = process.hrtime.bigint() - start;

    console.log(`${label}, ${variant.label}`, diff / 1_000_000n);

    expected ??= tree.root;

    if (tree.root !== expected) {
      throw new Error(`${label}: ${variant.label} root mismatch`);
    }
  }
}
