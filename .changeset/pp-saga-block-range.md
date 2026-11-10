---
"@kohaku-eth/privacy-pools": patch
---

The saga log source now returns only the requested block range. `@saga-sync/client` up to 0.3.0 uses the stream window only to pick chunks, so a `headBlock` clamp (a fork or a pinned view) still received events after it, whose leaves are not on that chain, and the pool root check failed the sync. It also re-sent every event before `fromBlock` on each sync, so an incremental sync took saga's last `RootUpdated` as the latest, replaced a newer ASP root already synced from the RPC, and failed the ASP root check.
