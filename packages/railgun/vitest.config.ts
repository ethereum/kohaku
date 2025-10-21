import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

// eslint-disable-next-line import/no-default-export
export default defineConfig(({ mode }) => ({
  test: {
    exclude: ['src/railgun/logic/**', 'src/railgun/lib/**'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 90000, // 1.5 minutes for e2e tests with proofs
    hookTimeout: 60000, // 1 minute for setup/teardown
    globals: true,
    environment: 'node',
    env: loadEnv(mode, 'tests', ''),
  },
  resolve: {
    alias: {
      '~railgun/lib': '/home/luc/dev/local/kohaku/packages/railgun/src/railgun/lib',
      '~railgun/logic': '/home/luc/dev/local/kohaku/packages/railgun/src/railgun/logic',
    },
  },
}));
