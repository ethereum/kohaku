---
"@kohaku-eth/privacy-pools": patch
---

Verify each pool's rebuilt state root against `currentRoot()` read at the synced block, instead of accepting any root in the Pool's recent history. A leaf stream missing its newest leaves, or all of them, now fails the sync rather than advancing the sync point past them: a pool with no stored leaves is checked as an empty tree. A stream with a hole in its leaf indices fails before any on-chain read. When the RPC's head is behind the sync point, nothing is scanned and only the ASP root is checked. `verifyStateRootOnChain` and `verifyRootsThunk` take the synced block number, `verifyRootsThunk` takes `verifyPoolRoots`, and `IDataService.getPoolStateRoot` accepts an optional block number.
