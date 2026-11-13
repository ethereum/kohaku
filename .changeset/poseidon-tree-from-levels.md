---
"@kohaku-eth/poseidon-lean-imt": patch
---

Export `parallelLevels` and add `PoseidonT3LeanIMT.fromLevels(levels)` to restore a local tree from trusted precomputed levels without hashing again. This lets offscreen builders return levels instead of a tree proxy tied to the offscreen document's lifetime.
