---
"@kohaku-eth/privacy-pools": patch
---

Keep working while the ASP service is down: `ragequit` no longer calls it, and a sync keeps the last good association set instead of failing. Withdrawals are refused until a sync gets the current set.
