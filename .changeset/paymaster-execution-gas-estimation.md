---
"@kohaku-eth/privacy-pools": patch
---

Paymaster withdrawals with an execution phase (`tailCalls` or batched notes) no longer sign an unverified execution budget. Before, a zero `tailCallsGasEstimate` produced a `callGasLimit` of zero, and an unavailable bundler estimate fell back to baseline gas. Either way, the calls could run out of gas after the payout reached the sender, leaving the funds there.

- `tailCallsGasEstimate` must be a positive bigint, in `prepareUnshield` and `estimateUnshield`.
- An execution phase requires successful bundler estimation with a positive `callGasLimit`, and the refined limits are estimated again before the SDK proves and signs.
- Single-note withdrawals without `tailCalls` keep the baseline fallback, since nothing runs after their payout.
