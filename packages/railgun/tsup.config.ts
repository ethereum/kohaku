/* eslint-disable import/no-default-export */
import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js build (ESM + CJS)
  {
    entry: { 
      index: 'src/index.ts', 
      'storage/layers/file': 'src/storage/layers/file.ts', 
      'storage/layers/empty': 'src/storage/layers/empty.ts' 
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    treeshake: true,
    tsconfig: 'tsconfig.json',
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
    ],
  },
  // Browser build (ESM only, no file storage)
  {
    entry: { 
      'index.browser': 'src/index.browser.ts'
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'es2022',
    treeshake: true,
    tsconfig: 'tsconfig.json',
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
    ],
  },
]);
