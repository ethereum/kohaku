---
"@kohaku-eth/privacy-pools": patch
---

Add `history()` returning the account's deposits, withdrawals and ragequits, newest first. Transaction hashes, log indexes and timestamps are fetched on demand for the user's own events and cached in state.
