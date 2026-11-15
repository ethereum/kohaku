---
"@kohaku-eth/tornado-cash": patch
---

Fail the sync when a pool's events cannot be fetched instead of dropping that pool
silently. Previously a rejected `getPoolEvents` (for example an RPC that refuses wide
`eth_getLogs` ranges) was ignored, so `balance` and `prepareUnshield` reported that
pool's notes as zero with no error. Pools that did sync still keep their progress, and
the failed ones keep their previous cursor, so the next sync retries exactly the range
that failed. The error is a `TornadoPoolSyncError` whose message lists the failed pools
and the first line of each distinct reason (request URLs, which may carry RPC API keys,
are left out).
