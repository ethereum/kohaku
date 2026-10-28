---
"@kohaku-eth/social-recovery": patch
---

Add `validateSetup` and `validateRequest`, which return every error and warning a setup draft or an assembled request reaches against the reads its client hands in, the two context records they take, and the shared request window helper `windowFindings`.
