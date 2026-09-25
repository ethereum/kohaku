---
"@kohaku-eth/plugins": patch
---

fix: `MnemonicKeystore` derives RAILGUN paths (coin type `1984'`) with the engine "babyjubjub seed" HMAC-SHA512 tree instead of BIP-32 secp256k1, so spending and viewing keys (and the 0zk address) match `@railgun-community/engine` wallets. Non-RAILGUN paths are unchanged.
