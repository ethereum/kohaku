---
"@kohaku-eth/tornado-cash": minor
---

Always pay single-note withdrawal proceeds and gas refunds directly to the requested recipient when no tail calls are supplied, for every supported account family, keeping execution calldata empty and execution gas zero. Explicit tail calls retain sender-bound sponsorship and execution for both single-note and batch withdrawals, with compatible EIP-7702 implementations or smart accounts.

Add explicit `executionGasRetry` opt-in for bounded recovery from recognized execution-gas shortages with a required positive `maxGasLimits.callGasLimit` ceiling. A ceiling alone no longer enables retries. Each retry rebuilds the fee, proof and signature and re-estimates the final signed operation.
