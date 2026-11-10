---
"@kohaku-eth/plugins": patch
---

Add `scopeKeystore(keystore, { prefixes, paths })`, which only derives below the given prefixes or at the listed exact paths and throws `KeystorePathNotAllowedError` otherwise, so each plugin can get its own slice of the wallet's keys. `MnemonicKeystore` now rejects phrases with a bad BIP-39 checksum or unknown words, malformed path segments (`0abc'`, `1e3'`, leading zeros, out-of-range indices) and the master key `m`, instead of silently deriving something else; it also keeps the phrase in a true private field. `parseDerivationPath` is exported for hosts that write their own keystore.
