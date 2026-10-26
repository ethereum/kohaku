---
"@kohaku-eth/privacy-pools": patch
---

Set the withdraw proof's `stateTreeDepth` and `ASPTreeDepth` public signals to `32` to match the official Privacy Pools implementation.

The circuit's Merkle siblings are already padded to the fixed depth of 32 (see `proofFromTree`), but the withdraw proof declared a tree depth of `2`. Emitting a tree-depth value that differs from the canonical Privacy Pools deployment makes our withdrawals stand out on-chain and would flag the withdrawing wallets. Using the same `32` value keeps our withdrawals indistinguishable from the rest of the pool's anonymity set.
