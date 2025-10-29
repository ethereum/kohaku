/* eslint-disable import/no-default-export */
import { defineConfig } from 'tsup';

export default defineConfig([
  // Node build (ESM + CJS)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    treeshake: true,
    platform: 'node',
    outDir: 'dist',
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
      '@railgun-community/poseidon-hash-wasm',
    ],
  },
  // Browser build (ESM only)
  {
    entry: { 'index.browser': 'src/index.browser.ts' },
    format: ['esm'],
    dts: { entry: 'src/index.browser.ts' },
    sourcemap: true,
    clean: false,
    target: 'es2022',
    treeshake: true,
    platform: 'browser',
    outDir: 'dist',
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
      '@railgun-community/poseidon-hash-wasm',
    ],
  },
]);
