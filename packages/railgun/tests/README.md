# Railgun Testing

This directory contains end-to-end tests for the Railgun package using Vitest and Anvil.

## Prerequisites

1. **Foundry/Anvil**: Install Foundry which includes Anvil:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **RPC Endpoint** (optional): Set `SEPOLIA_RPC_URL` if you have a Sepolia RPC endpoint:
   ```bash
   export SEPOLIA_RPC_URL="https://your-sepolia-rpc-url"
   ```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with UI
pnpm test:ui

# Run only e2e tests
pnpm test:e2e
```

## Test Structure

### `tests/utils/`
- **anvil.ts**: Anvil instance management (start/stop, forking, RPC methods)
- **test-accounts.ts**: Standard test accounts with known private keys
- **test-helpers.ts**: Helper functions for testing (funding, balances, etc.)

### `tests/e2e/`
- **railgun-flow.test.ts**: End-to-end tests for the full Railgun flow
  - Shield (deposit) ETH into Railgun
  - Private transfer between Railgun addresses
  - Unshield (withdraw) back to public addresses

## How Tests Work

1. **Anvil Fork**: Tests spin up a local Anvil instance that forks from Sepolia at a specific block
2. **Isolated Environment**: Each test runs in an isolated forked environment
3. **Real Contracts**: Tests interact with real Railgun contracts deployed on Sepolia
4. **No Real Transactions**: All transactions happen on the local fork, not on the actual network
5. **Fast & Reliable**: Tests are fast and don't depend on external network conditions

## Test Flow

The e2e tests simulate the complete Railgun privacy workflow:

```
┌─────────────────────────────────────────────────────────┐
│ 1. Setup                                                │
│    - Start Anvil (fork Sepolia)                        │
│    - Create test accounts (Alice, Bob)                 │
│    - Fund with ETH                                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Shield (Public → Private)                           │
│    - Alice shields 0.01 ETH to Railgun                │
│    - ETH becomes private, balance hidden                │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Private Transfer                                     │
│    - Alice transfers 0.001 ETH to Bob (privately)     │
│    - Transaction is private, amounts hidden             │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Unshield (Private → Public)                         │
│    - Bob unshields to his public address              │
│    - Private balance becomes public ETH                 │
└─────────────────────────────────────────────────────────┘
```

## Debugging & Troubleshooting

### Common Errors

**Error: "failed to get fork block number" or "HTTP error 522"**
- Your RPC endpoint is timing out or rate-limiting
- Try a different RPC endpoint

**Tests are slow (taking 2-3 minutes)**
- This is normal - ZK proof generation takes 10-30 seconds per transaction

### Debug Options

- **Anvil Logs**: Check test output for anvil errors
- **Verbose Mode**: Run with `VITEST_LOG_LEVEL=verbose`
- **UI Mode**: Use `pnpm test:ui` for interactive debugging

## CI/CD

Tests can run in CI/CD pipelines. Ensure:
1. Foundry/Anvil is installed in the CI environment
2. `SEPOLIA_RPC_URL` is set as a secret
3. Sufficient timeout is configured (tests can take 2-3 minutes)
