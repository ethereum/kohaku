---
"@kohaku-eth/tornado-cash": minor
---

fix!: report paymaster withdrawal outcomes correctly. Paymaster `broadcast()` used to drop failed withdrawals with only a `console.warn` and never checked the receipt's `success`, so a reverted user operation looked successful. It now resolves as soon as the bundler accepts the user operation, and each result has a `wait()` that resolves with the `txHash` once it is mined successfully. Both throw a `PaymasterBroadcastError` (`not-accepted`, `reverted` or `unconfirmed`), whose message never includes the signed user operation. If the send request fails but the bundler already has the user operation, `broadcast()` resolves as usual. An `Already known` answer to the send counts as accepted. Otherwise it reports `not-accepted`, with the hash, only if the bundler answered the send with an error, and `unconfirmed` with the hash if the send got no answer, because some bundlers only know mined user operations.

Callers that relied on `broadcast()` waiting for the receipt must now call `wait()`. Custom `paymasterClientFactory` clients must return `wait()` too.
