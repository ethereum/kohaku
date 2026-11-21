---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Preserve reuse of explicitly selected external and wallet-path EOAs without requiring `allowUsed: true`, including existing delegation to the selected implementation. Freshness checks remain the default for note-derived/random senders and smart accounts; explicit `allowUsed: false` also enforces them for wallet EOAs.

Budget factory deployment gas only when the prepared account still needs deployment. For Tornado execution-gas retries, retain a successful probe's gas budget instead of trimming back to an estimate that can fail again.
