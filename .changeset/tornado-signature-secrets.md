---
"@kohaku-eth/tornado-cash": minor
---

Add a signature-derived secret manager and use it for new deposits. Each note comes from one deterministic EIP-712 signature over a global nonce (`TornadoCashNote`), with the pool mixed in afterwards: the signature's canonical `(r, s)` (big-endian, low-s, recovery id `v` dropped) is hashed with the chain id and pool address into the nullifier and secret. The signing key is `m/29795'/1'/account'`.

The legacy BIP-32 `SecretManager` stays in the default scan, so notes created under that scheme are still discovered. Imported note strings are unchanged.
