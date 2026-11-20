/* eslint-disable import/no-default-export */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    exclude: ['*'],
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], testTimeout: 30_000 },
      },
      {
        extends: true,
        test: { name: 'e2e', include: ['tests/e2e/**/*.test.ts'], testTimeout: 900_000, hookTimeout: 300_000, fileParallelism: false },
      },
    ],
  },
});
