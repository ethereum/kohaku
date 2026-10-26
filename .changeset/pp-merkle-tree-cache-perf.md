---
"@kohaku-eth/privacy-pools": patch
---

Speed up `prepareUnshield` (paymaster flow) on an already-synced state by removing redundant Merkle and sync work:

- Cache each pool's state tree and the ASP tree in-process and derive roots and inclusion proofs from the cached tree — building it once, then extending it incrementally with `LeanIMT.insert` — instead of rebuilding the whole tree (O(n) poseidon hashes) on every root check and every per-note proof. Nothing is added to Redux or the persisted snapshot; the cache is keyed per pool / per entrypoint with a leaf-count + last-leaf guard, and `verifyRootsThunk` still checks every derived root against chain.
- Drop the redundant on-chain root re-verification in the paymaster withdrawal: the `sync()` the plugin runs immediately beforehand already verified the same, unchanged state against chain.
- Run `verifyRootsThunk`'s on-chain root reads (ASP latest root + each pool's state root) concurrently instead of one at a time.
- Skip no-op `registerPoolLeaves` dispatches for pools with no new leaves, avoiding a re-serialization of the entire cross-pool leaf structure per pool on every sync.

No persisted-state or public-API changes. Measured on a mainnet fork (real bundler + prover): 3-note batch `prepareUnshield` ~45s → ~12s, 1-note ~19s → ~5s, with the remainder dominated by zk proving.
