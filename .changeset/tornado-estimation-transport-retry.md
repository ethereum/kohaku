---
"@kohaku-eth/tornado-cash": patch
---

Improve paymaster estimation availability without restoring silent catch-all fallback.
Retry recognized temporary transport failures once, using the exact signed payload
and honoring short Retry-After headers. Broadcasts are never retried by this logic.

Add gasEstimationPolicy (default best-effort, with required available for strict
callers). On mainnet/Sepolia, standard withdrawals with recoverable senders and no
user tail calls may fall back after recognized transport failures or the bundler's
opaque simulation-parser internal error. Real validation failures, invalid estimates,
random senders, unknown chains and user tail calls never use this fallback.

Rebuild fallback fees, proofs, forwarding calldata and signatures using 350000 gas
of pre-verification overhead plus a variable-payload allowance, preserving higher
previous estimates. Reject fees that consume the sponsoring note. Prepared payloads
include gasEstimation metadata so consumers can display or reject fallback results.
Fallback budgets are conservative heuristics and may still be rejected or execute
unsuccessfully; consumers must display the actual committed fee before broadcasting.
