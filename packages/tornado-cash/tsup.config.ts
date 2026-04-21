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
    treeshake: true,
    noExternal: [/.*/],
    splitting: false,
  },
]);
