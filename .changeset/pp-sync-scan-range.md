---
"@kohaku-eth/privacy-pools": patch
---

A sync on an RPC whose head is behind the last scanned head now leaves the state untouched, instead of pruning unfinalized events it cannot scan again or requesting an inverted block range, which real nodes reject. Pools are always scanned from the sync cursor rather than from the data source's reported registration block, so a forged registration block can no longer skip a pool's history.
