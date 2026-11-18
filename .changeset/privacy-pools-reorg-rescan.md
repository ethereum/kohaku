---
"@kohaku-eth/privacy-pools": patch
---

Sync drops everything after the last finalized block and scans it again, so a reorg can no longer leave events from an abandoned branch in the state. `IDataService` gains `getFinalizedBlockNumber()`.
