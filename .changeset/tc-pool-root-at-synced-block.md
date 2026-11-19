---
"@kohaku-eth/tornado-cash": patch
---

Verify each pool's events before storing them: the tree they complete must match the Pool's `getLastRoot()` read at the synced block, instead of the pool cursor advancing on whatever the sync source returned. A stream from the external sync provider or the chain that is missing leaves (including its newest ones, whose root is still in the recent history), has a hole in its leaf indices, or carries a forged leaf now fails the sync and leaves that pool's events and cursor untouched, so the next sync retries it. A pool with no synced leaves is checked through `nextIndex()`. Pools that pass keep their progress. `syncEventsThunk` takes a `dataService`, and `IDataService` gains `getPoolNextIndex` and an optional block number on `getPoolStateRoot`.
