import { defineConfig } from 'tsup';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'recovery-methods': 'src/recovery-methods/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  tsconfig: 'tsconfig.json',
  external: ['@zkpassport/sdk', '@anon-aadhaar/core'],
});
