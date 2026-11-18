---
"@kohaku-eth/privacy-pools": patch
---

Verify each pool's rebuilt state root against `currentRoot()` read at the synced block, instead of accepting any root in the Pool's recent history. A leaf stream missing its newest leaves now fails the sync rather than advancing the sync point past them, and a stream with a hole in its leaf indices fails before any on-chain read. `verifyStateRootOnChain` and `verifyRootsThunk` take the synced block number, and `IDataService.getPoolStateRoot` accepts an optional block number.
