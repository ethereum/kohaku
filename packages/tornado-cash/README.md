# @kohaku-eth/tornado-cash

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Tornado Cash Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/tornado-cash
```

## Random paymaster delegation

> **`delegation: { mode: 'random' }` is safe ONLY for a single-note withdrawal with no `tailCalls`. It is UNSAFE for ALL multi-note withdrawals and ANY withdrawal with `tailCalls`.**

The safe single-note path uses `callGasLimit = 0` and pays both the withdrawal and its unused gas-fee refund directly to the requested recipient. Neither is routed through the throwaway sender. On mainnet/Sepolia, the default `gasEstimationPolicy: 'best-effort'` can return marked fallback gas if host-RPC simulation is unavailable or state overrides are unsupported, while preserving this direct payout. Use `'required'` to require successful estimation and final simulation. Fallback is not a guarantee of bundler acceptance or a gas refund; review its fee before submission.

Multi-note withdrawals and withdrawals with `tailCalls` pay the sender before execution. An execution failure can permanently strand the sponsoring note's proceeds; a later gas refund can also be inaccessible even when forwarding succeeds. The random key is discarded, so successful estimation does not make these paths safe. Use a securely recoverable deterministic or external signer instead.

A single UserOperation can spend multiple notes. Omit `tailCalls` entirely for the safe single-note path; even an empty callback is unsafe. The SDK does not currently reject unsafe random delegation automatically, so integrators must enforce this restriction. See [delegation options](../../docs/pages/tornado-cash/options.mdx#delegation).
