---
"@kohaku-eth/privacy-pools": patch
---

Only count a saga stream's events from the requested contract as that pool's leaves. A protocol's stream can carry several contracts' events, and one that decoded as the pool's `Deposited` or `Withdrawn` used to become a leaf and shift every later leaf index.
