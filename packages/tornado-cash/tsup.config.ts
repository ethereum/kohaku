/* eslint-disable max-lines */
/* eslint-disable import/no-default-export */
/// <reference types="node" />

import { readFileSync } from 'fs';
import { defineConfig } from 'tsup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plugin = Exclude<Exclude<Parameters<typeof defineConfig>[0], Array<any> | ((params: any) => any)>['esbuildPlugins'], undefined>[number];

const sourcemap: boolean | 'inline' = false;

// micro-zk-proofs/msm.js uses `import.meta.url` to locate msm-worker.js at runtime.
// esbuild replaces import.meta.url with `var import_meta = {}` in CJS output, making
// import_meta.url undefined and causing `new URL('./msm-worker.js', undefined)` to throw.
// This plugin intercepts the source file and replaces import.meta.url with a __filename-
// based expression, which is always available in the CJS module scope.
// micro-zk-proofs bundles its own copy of @noble/curves in its nested node_modules.
// That produces two class instances for G1.Point in the bundle, breaking the `instanceof`
// check inside `modifyArgs` (noble-curves uses .X/.Y/.Z, not .px/.py/.pz, so the fallback
// `new point(res.px, ...)` crashes with "expected bigint, got undefined").
// This plugin re-routes every @noble/curves import that originates from inside a nested
// node_modules folder (i.e., micro-zk-proofs' private copy) back to the project root so
// esbuild deduplicates them into a single class instance.
const dedupeNobleCurves: Plugin = {
  name: 'dedupe-noble-curves',
  setup(build) {
    build.onResolve({ filter: /^@noble\/curves/ }, async (args) => {
      // Only redirect imports from inside a nested node_modules (micro-zk-proofs' copy).
      if (!args.resolveDir.includes(`micro-zk-proofs`)) return;

      return build.resolve(args.path, { resolveDir: process.cwd(), kind: args.kind });
    });
  },
};

// The browser ESM state-manager worker spawns MSM sub-workers using
// `new URL('./msm-worker.js', import.meta.url)`. msm-worker.js is built with
// platform:'node' (uses worker_threads' parentPort), which breaks in browser Web Workers.
// This plugin rewrites that reference to msm-worker.browser.js, which is built with
// platform:'browser' (uses globalThis.addEventListener), so the sub-workers work correctly.
const fixMsmWorkerUrlBrowser: Plugin = {
  name: 'fix-msm-worker-url-browser',
  setup(build) {
    // Rewrite the URL string in the source so the browser bundle spawns the browser worker.
    // Split the string literal so esbuild's static new URL() pattern detector doesn't emit
    // an `import {} from "./msm-worker.browser.js"` side-effect that would register the
    // worker's message handler inside the state-manager worker context, corrupting its
    // own message dispatch.
    build.onLoad({ filter: /micro-zk-proofs[/\\]msm\.js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      // Replace: new URL('./msm-worker.js', import.meta.url)
      //    with: new URL('./msm-worker.' + 'browser.js', import.meta.url)
      // The split string defeats esbuild's static-URL pattern so it doesn't emit a
      // top-level import for the file, while still resolving correctly at runtime.
      const contents = source.replace(
        /new URL\(['"]\.\/msm-worker\.js['"],\s*import\.meta\.url\)/g,
        `new URL('./msm-worker.' + 'browser.js', import.meta.url)`
      );

      return { contents, loader: 'js' };
    });
  },
};

const fixMsmWorkerUrl: Plugin = {
  name: 'fix-msm-worker-url',
  setup(build) {
    build.onLoad({ filter: /micro-zk-proofs[/\\]msm\.js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const contents =
        `import { pathToFileURL as __pathToFileURL } from 'url';\n` +
        source.replace(/\bimport\.meta\.url\b/g, '__pathToFileURL(__filename).href');

      return { contents, loader: 'js' };
    });
  },
};

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap,
    clean: true,
    target: 'es2022',
    platform: 'browser',
    treeshake: true,
    splitting: true,
    external: ['viem', '#worker-loader', '#circuit-loader'],
  },
  {
    entry: { 'worker-loader.browser': 'src/plugin/worker-loader.browser.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    external: ['comlink'],
  },
  {
    entry: { 'worker-loader.node': 'src/plugin/worker-loader.node.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: true,
    clean: false,
    target: 'es2022',
    platform: 'node',
    external: ['comlink', 'worker_threads', 'url', 'path'],
  },
  {
    entry: { 'state-manager.worker': 'src/state/state-manager.worker.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    treeshake: false,
    splitting: false,
    noExternal: [/^(?!(crypto|worker_threads)$)/],
    external: ['crypto', 'worker_threads', '#circuit-loader'],
    // websnark's groth16.js uses `typeof window !== 'undefined'` to detect browser vs Node.
    // Web Workers don't have `window`, so it falls into the Node path and attempts worker_threads.
    // An empty object makes the detection pass while leaving window.document / localStorage etc.
    // as undefined — same as they would be in a worker — so other libraries are unaffected.
    banner: { js: 'if (typeof window === "undefined") globalThis.window = { crypto: globalThis.crypto };' },
    // Polyfill Buffer for websnark's groth16_wasm.js which references it as a global.
    // esbuild's inject rewrites free `Buffer` references to the bundled browser polyfill.
    inject: ['./src/polyfills/buffer-polyfill.ts'],
    esbuildPlugins: [dedupeNobleCurves, fixMsmWorkerUrlBrowser],
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
  {
    entry: { 'state-manager.worker.node': 'src/state/state-manager.worker.node.ts' },
    outDir: 'dist',
    format: ['cjs'],
    sourcemap,
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'node',
    treeshake: false,
    splitting: false,
    noExternal: [/^(?!(crypto|worker_threads|path|url|fs|buffer|events|util|os|stream|#worker-loader|#circuit-loader)$)/],
    external: ['crypto', 'worker_threads', '#worker-loader', '#circuit-loader'],
    esbuildPlugins: [fixMsmWorkerUrl, dedupeNobleCurves],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        'snarkjs/src/circuit': './node_modules/snarkjs/src/circuit.js',
        'snarkjs/src/bigint': './node_modules/snarkjs/src/bigint.js',
        'snarkjs/src/stringifybigint': './node_modules/snarkjs/src/stringifybigint.js',
      };
    },
  },
  {
    entry: { 'msm-worker': 'src/msm-worker.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'node',
    treeshake: false,
    splitting: false,
    noExternal: [/^(?!(worker_threads)$)/],
    external: ['worker_threads'],
    esbuildOptions(options) {
      // micro-zk-proofs marks all files with sideEffects: false.
      // The bare import `import 'micro-zk-proofs/msm-worker.js'` would be dropped
      // without this flag, producing an empty bundle.
      options.ignoreAnnotations = true;
    },
  },
  // Browser counterpart: same source but platform:'browser' so micro-wrkr resolves to
  // its browser implementation (globalThis.addEventListener) instead of the Node one
  // (worker_threads parentPort), which doesn't exist in browser Web Workers.
  {
    entry: { 'msm-worker.browser': 'src/msm-worker.browser.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    treeshake: false,
    splitting: false,
    noExternal: [/.*/],
    esbuildOptions(options) {
      options.ignoreAnnotations = true;
    },
  },
]);
