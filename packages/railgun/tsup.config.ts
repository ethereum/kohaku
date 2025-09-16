import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  external: [
    'ethers',
    '@noble/ed25519',
    'ethereum-cryptography',
    'snarkjs',
    'circomlibjs',
    'buffer-xor',
    '@railgun-community/circomlibjs',
    '@railgun-community/circuit-artifacts',
    '@railgun-community/curve25519-scalarmult-wasm',
    '@railgun-community/poseidon-hash-wasm'
  ]
});
