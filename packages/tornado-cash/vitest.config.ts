import { defineConfig } from 'vitest/config';

const CHAINS = [
  { chainId: 1, chainName: 'mainnet' },
  { chainId: 11155111, chainName: 'sepolia' },
] as const;

const E2E_SUITES = [
  { suiteName: 'all',             include: ['tests/unit/**/*.test.ts', 'tests/e2e/**/*.test.ts'], timeout: 600_000 },
  { suiteName: 'e2e',             include: ['tests/e2e/**/*.test.ts'],                    timeout: 600_000 },
  { suiteName: 'shield',          include: ['tests/e2e/**/shield.test.ts'],               timeout: 600_000 },
  { suiteName: 'withdraw-mocked', include: ['tests/e2e/**/withdraw.test.ts'],             timeout: 600_000 },
  { suiteName: 'withdraw-live',   include: ['tests/e2e/**/withdraw-real-prover.test.ts'], timeout: 600_000 },
  { suiteName: 'ragequit',        include: ['tests/e2e/**/ragequit.test.ts'],             timeout: 600_000 },
  { suiteName: 'sync',            include: ['tests/sync.test.ts'],                        timeout: 1_200_000 },
  { suiteName: 'asp-integration', include: ['tests/e2e/asp-services.test.ts'],            timeout: 60_000 },
];

const chainProjects = CHAINS.flatMap(chain =>
  E2E_SUITES.map(suite => ({
    extends: true as const,
    test: {
      name: `${suite.suiteName}-${chain.chainName}`,
      include: suite.include,
      testTimeout: suite.timeout,
      provide: { chainId: chain.chainId },
    },
  }))
);

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    exclude: ['*'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 5_000,
        }
      },
...chainProjects,
    ]
  },
});

declare module 'vitest' {
  interface ProvidedContext {
    chainId: 1 | 11155111;
  }
}