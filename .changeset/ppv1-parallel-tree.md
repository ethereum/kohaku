---
"@kohaku-eth/privacy-pools": patch
---

Build the state and ASP Merkle trees with `@kohaku-eth/poseidon-lean-imt` instead of `@zk-kit/lean-imt`, which is no longer a dependency. Trees of 2048 leaves or more are built from scratch on workers (`PoseidonT3LeanIMT.fromLeavesParallel`); smaller ones are still built in-thread, where starting the workers would cost more than the hashing. Root and proof derivation is now async: the in-process tree cache holds each tree's build as a promise, so concurrent callers share one build and appended leaves apply in order even while a build is in flight, and a failed build or insert is evicted instead of staying cached. A withdrawal fetches its state and ASP proofs concurrently. No persisted-state or public-API changes.
