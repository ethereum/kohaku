---
"@kohaku-eth/privacy-pools": patch
---

The secret manager now gets a keystore scoped to `m/28784'/1'` plus the exact `delegation.path` of a paymaster unshield, instead of the host's whole keystore. A custom `secretManager` that derives other paths gets `KeystorePathNotAllowedError`. `PRIVACY_POOLS_KEYSTORE_PREFIX` is exported.
