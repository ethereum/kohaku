---
"@kohaku-eth/tornado-cash": patch
---

A paymaster unshield's `delegation.path` is now allowed on the scoped keystore and the worker's secret-manager bridge only while that unshield is being prepared. Before, every path ever named stayed allowed for the life of the protocol instance, including invalid ones and those of failed preparations, and each key derivation scanned all of them.
