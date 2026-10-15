---
"@kohaku-eth/privacy-pools": minor
---

Add a signature-derived secret manager and make it the default. Note secrets are now derived from one deterministic EIP-712 signature per note instead of per-note BIP-32 HD keys: the signature's canonical `(r, s)` (big-endian, low-s normalized, recovery id `v` dropped) is hashed with per-role tags into the nullifier and salt, so derivation is identical across any compliant signer — software or hardware (Ledger-style `v‖r‖s`, viem `r‖s‖v`, and ERC-2098 compact signatures all converge). The signing identity is the shared account key at `m/28784'/1'/account'`.

`SignatureSecretManager` is now the default `secretManager` for `PrivacyPoolsV1Protocol`; the legacy BIP-32 HD `SecretManager` is marked `@deprecated` but kept for explicit injection. Signers plug in at a narrow `EnvelopeSigner` seam (`signEnvelope`) so they can never diverge the typed-data standard.

BREAKING: the two schemes derive disjoint notes, so the default change is a breaking derivation change — deposits created under the old default will not be rediscovered. Acceptable as the package is unreleased (alpha) with no real users; callers needing the old behavior can inject `SecretManager` explicitly.
