/* eslint-disable import/no-default-export */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  // tsup only auto-externalizes dependencies/peerDependencies; the SDK lives in
  // optionalDependencies (GitHub Packages needs auth even for reads — see the
  // package README), so it must be pinned external here or the whole SDK gets
  // inlined into the bundle (broken web-worker CJS shims included).
  external: ['viem', '@0xbow-io/privacy-pools-v2-sdk']
});
