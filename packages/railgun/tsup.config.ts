/* eslint-disable import/no-default-export */
import { defineConfig } from 'tsup'

const target = 'es2022'
const wasmAssets = ['../vendor/wasm/*']

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm'],
    dts: true,
    target,
    platform: 'browser',
    splitting: false,
    clean: true,
    external: ['#worker-loader', ...wasmAssets],
  },
  {
    entry: { 'worker-loader.node': 'src/worker-loader.node.ts' },
    outDir: 'dist',
    format: ['esm'],
    target,
    platform: 'node',
    splitting: false,
    clean: false,
  },
  {
    entry: { 'worker-loader.browser': 'src/worker-loader.browser.ts' },
    outDir: 'dist',
    format: ['esm'],
    target,
    platform: 'browser',
    splitting: false,
    clean: false,
  },
  {
    entry: { 'railgun-worker.node': 'src/railgun-worker.node.ts' },
    outDir: 'dist',
    format: ['esm'],
    target,
    platform: 'node',
    splitting: false,
    clean: false,
    external: wasmAssets,
  },
  {
    entry: { 'railgun-worker.browser': 'src/railgun-worker.browser.ts' },
    outDir: 'dist',
    format: ['esm'],
    target,
    platform: 'browser',
    splitting: false,
    clean: false,
    external: wasmAssets,
  },
])
