---
"@kohaku-eth/tornado-cash": patch
---

Require successful bundler gas estimation when preparing paymaster withdrawals.
Previously an estimation failure silently returned static limits, which could
produce signed operations rejected for insufficient preVerificationGas.

Single-note and consolidated withdrawals now rebuild the sponsoring fee, proof,
forwarding calldata and signature when gas estimates increase, then estimate the
exact rebuilt payload again. Refinement is bounded to three attempts.

Single-note withdrawals now also pay the recoverable sender and forward to the
requested recipient during execution.
This avoids `CallGasLimitNonZero` when bundlers inject a nonzero gas-search
ceiling during estimation. Explicit delegation settings apply to single notes
too; unused-gas refunds can remain on the sender after forwarding.

Bundler HTTP requests use a 180-second timeout and no transport retries. Preparation now rejects on estimation failure,
invalid estimates or non-convergence instead of returning an unchecked fallback.
