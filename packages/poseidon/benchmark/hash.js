import { poseidon } from 'maci-crypto/build/ts/hashing.js';
import { poseidonT3 } from '../dist/index.js';

const WARMUP_ITERATIONS = 1_000;

const cases = [
  { label: '1k hashes', size: 1_000 },
  { label: '10k hashes', size: 10_000 },
  { label: '100k hashes', size: 100_000 },
].map(({ label, size }) => ({
  label,
  elements: Array.from({ length: size }, (_, index) => BigInt(index)),
}));

const variants = [
  { label: 'kohaku poseidonT3', hash: poseidonT3 },
  { label: 'maci-crypto poseidon', hash: (a, b) => poseidon([a, b]) },
];

// Chains every hash into the next one so the work can't be optimized away
// and both variants can be checked against each other.
function run(hash, elements) {
  let acc = 0n;
  for (const element of elements) {
    acc = hash(acc, element);
  }
  return acc;
}

for (const variant of variants) {
  run(variant.hash, cases[0].elements.slice(0, WARMUP_ITERATIONS));
}

for (const { label, elements } of cases) {
  let expected;
  for (const variant of variants) {
    const start = process.hrtime.bigint();
    const result = run(variant.hash, elements);
    const diff = process.hrtime.bigint() - start;
    console.log(`${label}, ${variant.label}`, diff / 1_000_000n);

    expected ??= result;
    if (result !== expected) {
      throw new Error(`${label}: ${variant.label} result mismatch`);
    }
  }
}
