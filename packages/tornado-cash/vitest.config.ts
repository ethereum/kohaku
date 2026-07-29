import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const CHAINS = [
  { chainId: 1, chainName: 'mainnet' },
  { chainId: 11155111, chainName: 'sepolia' },
] as const;

const E2E_SUITES = [
  { suiteName: 'all',             include: ['tests/unit/**/*.test.ts', 'tests/e2e/**/*.test.ts'], timeout: 600_000 },
  { suiteName: 'e2e',             include: ['tests/e2e/**/*.test.ts'],                    timeout: 600_000 },
  { suiteName: 'shield',          include: ['tests/e2e/**/shield.test.ts'],               timeout: 600_000 },
  { suiteName: 'withdraw',         include: ['tests/e2e/**/withdraw.test.ts'],              timeout: 600_000 },
  { suiteName: 'withdraw-paymaster', include: ['tests/e2e/**/withdraw-paymaster.test.ts'], timeout: 600_000 },
  { suiteName: 'sync',            include: ['tests/sync.test.ts'],                        timeout: 1_200_000 },
];

// Per-chain e2e projects are only run when explicitly invoked (e.g.
// `--project=e2e-sepolia`); mainnet runs require the dev to set up an RPC and a
// synced state snapshot, so they're never part of the default suite.
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
    alias: { '@kohaku-eth/tornado-cash': resolve(__dirname, 'dist/index.js') },
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