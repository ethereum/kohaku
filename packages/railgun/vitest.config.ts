import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    exclude: ["src/railgun/logic/**", "src/railgun/lib/**"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 90000, // 1.5 minutes for e2e tests with proofs
    hookTimeout: 60000, // 1 minute for setup/teardown
    globals: true,
    environment: "node",
    env: loadEnv(mode, "tests", ""),
  },
  // resolve: {
  //   alias: {
  //     '~/*': './src/*',
  //   },
  // },
  plugins: [tsconfigPaths()],
}));
