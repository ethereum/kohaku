import { defineConfig } from 'vitest/config';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    exclude: [ '*' ],
    projects: [
      {
        extends: true,
        test: {
          name: 'shield',
          include: ['tests/e2e/**/shield.test.ts'],
          testTimeout: 600_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'withdraw-mocked',
          include: ['tests/e2e/**/withdraw.test.ts'],
          testTimeout: 600_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'withdraw-live',
          include: ['tests/e2e/**/withdraw-real-prover.test.ts'],
          testTimeout: 600_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'ragequit',
          include: ['tests/e2e/**/ragequit.test.ts'],
          testTimeout: 600_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          testTimeout: 600_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 5_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'sync',
          include: ['tests/sync.test.ts'],
          testTimeout: 1200_000,
        }
      },
      {
        extends: true,
        test: {
          name: 'asp-integration',
          include: ['tests/e2e/asp-services.test.ts'],
          testTimeout: 60_000,
        }
      }
    ]
  },
});
