---
"@kohaku-eth/privacy-pools": patch
"@kohaku-eth/poseidon-lean-imt": patch
---

Build Privacy Pools Merkle trees in the calling thread when workers are unavailable or fail, including Chrome MV3 service workers and React Native. Add an optional `merkleTreeBuilder` callback with async tree methods for offscreen/worker bridges, and clean up workers when a pool only partially starts.
