/* eslint-disable import/no-default-export */
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 
      index: 'src/index.ts', 
      ethers: 'src/ethers/index.ts',
      viem: 'src/viem/index.ts',
      colibri: 'src/colibri/index.ts',
      helios: 'src/helios/index.ts',
      raw: 'src/raw/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: {
      resolve: true,
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    sourcemap: true,
    clean: true,
    target: 'es2022',
    treeshake: true,
    tsconfig: 'tsconfig.json',
    external: [
      'ethers',
      '@a16z/helios',
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
