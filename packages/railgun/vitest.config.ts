import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check Node.js version - require 18+ (22+ recommended for Promise.withResolvers in tests)
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0] || '0', 10);

if (majorVersion < 18) {
  throw new Error(
    `\n❌ Node.js version ${nodeVersion} is not supported.\n` +
    `   This package requires Node.js 18.0.0 or higher.\n` +
    `   Please upgrade Node.js: https://nodejs.org/\n` +
    `   Current version: ${nodeVersion}\n`
  );
}

// Ensure foundry/bin is in PATH for anvil (used by prool)
const foundryBinPath = process.env.HOME ? `${process.env.HOME}/.foundry/bin` : '/Users/.foundry/bin';

if (!process.env.PATH?.includes(foundryBinPath)) {
  process.env.PATH = `${foundryBinPath}:${process.env.PATH || ''}`;
}

const isIntegrationRun = process.env.INTEGRATION === '1';

if (!isIntegrationRun) {
  console.warn(
    '\n[railgun:test] !IMPORTANT: RAILGUN TESTS ARE BEING SKIPPED.' +
      '\nRun with INTEGRATION=1 (or use the justfile targets) to execute railgun tests.\n'
  );
} else {
  const wasmEntrypoint = path.resolve(__dirname, 'src/pkg/railgun_rs.js');
  if (!existsSync(wasmEntrypoint)) {
    throw new Error(
      '\n[railgun:test] Missing WASM build output at src/pkg/railgun_rs.js.' +
        '\nBuild first with `just wasm` (or `pnpm run build:wasm`) and rerun tests.\n'
    );
  }
}

// eslint-disable-next-line import/no-default-export
export default defineConfig(({ mode }) => ({
  test: {
    passWithNoTests: true,
    exclude: ['src/railgun/logic/**', 'src/railgun/lib/**'],
    include: isIntegrationRun ? ['tests/**/*.test.ts'] : [],
    testTimeout: 90000, // 1.5 minutes for e2e tests with proofs
    hookTimeout: 60000, // 1 minute for setup/teardown
    globals: true,
    environment: 'node',
    env: loadEnv(mode, 'tests', ''),
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
      '~/*': path.resolve(__dirname, './src/*'),
    },
  },
  optimizeDeps: {
    include: ['@noble/hashes/sha2', '@noble/hashes/sha3'],
  },
  plugins: [tsconfigPaths()]
}));
