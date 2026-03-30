import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          setupFiles: ['tests/utils/setup.ts'],
        }
      }
    ]
  },
});
