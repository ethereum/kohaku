---
"@kohaku-eth/privacy-pools": minor
---

fix: report paymaster withdrawal outcomes correctly. Paymaster `broadcast()` now resolves once the bundler accepts the userOp, and the returned `wait()` checks the receipt's `success`. Failures throw a `PaymasterBroadcastError` without the signed userOp. Custom `IPaymasterBroadcasterClient`s must return `wait()` instead of `txHash`, and reject instead of omitting failed withdrawals.
