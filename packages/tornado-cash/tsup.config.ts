/// <reference types="node" />
/* eslint-disable import/no-default-export */

import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    treeshake: true,
    splitting: true,
    external: ['viem'],
  },
  {
    entry: { 'state-manager.worker': 'src/state/state-manager.worker.ts' },
    outDir: 'dist/worker',
    format: ['esm'],
    dts: false,
    sourcemap: 'inline',
    clean: false,
    target: 'es2022',
    platform: 'browser',
    treeshake: false,
    noExternal: [/^(?!(crypto|worker_threads)$)/],
    external: ['crypto', 'worker_threads'],
    splitting: true,
    // websnark's groth16.js uses `typeof window !== 'undefined'` to detect browser vs Node.
    // Web Workers don't have `window`, so it falls into the Node path and attempts worker_threads.
    // An empty object makes the detection pass while leaving window.document / localStorage etc.
    // as undefined — same as they would be in a worker — so other libraries are unaffected.
    banner: { js: 'if (typeof window === "undefined") globalThis.window = { crypto: globalThis.crypto };' },
    // Polyfill Buffer for websnark's groth16_wasm.js which references it as a global.
    // esbuild's inject rewrites free `Buffer` references to the bundled browser polyfill.
    inject: ['./src/polyfills/buffer-polyfill.ts'],
    esbuildOptions(options) {
      // websnark/src/groth16 probes for Node builtins (assert, crypto, worker_threads)
      // inside a try/catch to detect browser vs Node. Marking them external causes esbuild
      // to hoist the require() to a module-level ESM import, which runs before the try/catch
      // and throws "Dynamic require is not supported". Using alias instead bundles empty stubs
      // so the require() stays inline and the catch block handles browser detection correctly.
      // websnark/src/utils.js requires snarkjs internal paths that are blocked by
      // the exports field of the modern snarkjs versions hoisted by pnpm. Alias
      // them to the tornadocash snarkjs fork (v0.1.20, no exports restrictions)
      // installed locally, which is the version websnark was written against.
      options.alias = {
        ...options.alias,
        assert: './src/polyfills/assert-polyfill.cjs',
        'snarkjs/src/circuit': './node_modules/snarkjs/src/circuit.js',
        'snarkjs/src/bigint': './node_modules/snarkjs/src/bigint.js',
        'snarkjs/src/stringifybigint': './node_modules/snarkjs/src/stringifybigint.js',
      };
    },
  },
]);
