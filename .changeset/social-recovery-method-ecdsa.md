---
"@kohaku-eth/social-recovery": patch
---

Add the wallet method (`method-ecdsa`): `walletMethod()` returns the shipped `IRecoveryMethod` for guardians enrolled by address, with its config and proof codec, low-s and 27/28 normalization of returned signatures, and a local verdict that answers not judged where the ERC-1271 path would decide. Adds `viem` as a dependency.
