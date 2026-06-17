/* eslint-disable max-lines */
/* eslint-disable import/no-default-export */
/// <reference types="node" />

import { readFileSync } from 'fs';
import { defineConfig } from 'tsup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plugin = Exclude<Exclude<Parameters<typeof defineConfig>[0], Array<any> | ((params: any) => any)>['esbuildPlugins'], undefined>[number];

const sourcemap: boolean | 'inline' = false;


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
    external: ['viem', '#worker-loader', '#circuit-loader', '#merkle-tree'],
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
  },
  {
    entry: { 'merkle-tree.browser': 'src/utils/merkle-tree/merkle-tree.util.browser.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
  },
  {
    entry: { 'merkle-tree.node': 'src/utils/merkle-tree/merkle-tree.util.node.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: true,
    clean: false,
    target: 'es2022',
    platform: 'node',
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
    esbuildPlugins: [fixMsmWorkerUrlBrowser],
  },
  {
    entry: { 'state-manager.worker.node': 'src/state/state-manager.worker.node.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'node',
    treeshake: false,
    splitting: false,
    noExternal: [/^(?!(crypto|worker_threads|path|url|fs|buffer|events|util|os|stream|#worker-loader|#circuit-loader|#merkle-tree)$)/],
    external: ['crypto', 'worker_threads', '#worker-loader', '#circuit-loader', '#merkle-tree'],
    esbuildPlugins: [],
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
    {
    entry: { 'merkle-tree-worker.browser': 'src/merkle-tree-worker.browser.ts' },
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
  },
    {
    entry: { 'merkle-tree-worker.node': 'src/merkle-tree-worker.node.ts' },
    outDir: 'dist',
    format: ['esm'],
    sourcemap,
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'node',
    treeshake: false,
    splitting: false,
    noExternal: [/.*/],
  },
]);
