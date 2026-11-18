---
"@kohaku-eth/privacy-pools": patch
---

Sync drops everything after the last finalized block and scans it again, so a reorg can no longer leave events from an abandoned branch in the state. A state saved by an earlier version is rewound once, `LEGACY_REWIND_BLOCKS` below its saved head. Pool wind-downs are now recorded for pools registered in an earlier sync. `IDataService` gains `getFinalizedBlockNumber()`.
