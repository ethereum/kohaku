---
"@kohaku-eth/privacy-pools": patch
---

Requires `@saga-sync/client` 0.4.0, which rejects a saga record whose `blockNumber` or `logIndex` is not minimal `0x`-hex or whose `logIndex` is past `Number.MAX_SAFE_INTEGER`. Up to 0.3.0 such a record reached the saga log source, where converting it threw outside any catch and failed every sync, since each sync streams the pool from block 0.
