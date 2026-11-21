---
"@kohaku-eth/privacy-pools": patch
---

A paymaster unshield's `delegation.path` is now allowed on the scoped keystore only while that unshield is being prepared. Before, every path ever named stayed allowed for the life of the protocol instance, including invalid ones and those of failed preparations, and each key derivation scanned all of them.
