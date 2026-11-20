---
"@kohaku-eth/tornado-cash": patch
---

Fail the sync when a pool's configuration or events cannot be fetched instead of
dropping that pool silently. Previously a rejected `getPoolEvents` (for example an RPC
that refuses wide `eth_getLogs` ranges) or pool configuration lookup was ignored, so
`balance` and `prepareUnshield` reported that pool's notes as zero with no error. A pool
that still fails verification after the chain replay is reported the same way. Pools
that did sync keep their progress, which is now saved before the sync fails, and the
failed ones keep their previous cursor, so the next sync retries exactly the range that
failed. An RPC node that lags behind a pool's saved head does not fail the sync: the
pool keeps the events it already had. The error is a `TornadoPoolSyncError` whose
message lists the failed pools and the first line of each distinct reason (request
URLs, which may carry RPC API keys, are left out).
