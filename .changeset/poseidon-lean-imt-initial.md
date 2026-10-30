---
"@kohaku-eth/poseidon-lean-imt": patch
---

Add `@kohaku-eth/poseidon-lean-imt`, a lean incremental Merkle tree over Poseidon T3 that builds the same tree as `@zk-kit/lean-imt`'s `LeanIMT` with `poseidonT3` as its hash. `PoseidonT3LeanIMT` keeps every level, so `insert`, `insertMany`, `indexOf`/`has` (a leaf-to-index map instead of a scan) and `generateProof`/`verifyProof` never rehash more than the touched path. `PoseidonT3LeanIMT.fromLeavesParallel(leaves, { workers?, workerUrl? })` builds a tree from scratch hashing level by level on `node:worker_threads` under Node or module Web Workers in the browser; `workers` defaults to the number of logical CPUs, capped at 16, and `workerUrl` points at `@kohaku-eth/poseidon-lean-imt/worker.js` for bundlers that do not emit the worker on their own. Exports the `LeanIMTMerkleProof` and `ParallelOptions` types.
