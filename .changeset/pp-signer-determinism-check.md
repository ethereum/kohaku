---
"@kohaku-eth/privacy-pools": patch
---

`SignatureSecretManager` now checks that its signer is deterministic before handing out any note secret. Secrets are never stored and are re-derived from the signatures after a restart, so a signer that adds entropy (viem's `setSignEntropy(true)`, some custom signers) created deposits that could later be neither withdrawn nor ragequit. The first note envelope of each session is signed twice and derivation throws if the signatures differ; this costs one extra signature (one extra hardware prompt) per session and can be turned off with `verifyDeterminism: false`.
