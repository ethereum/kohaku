---
"@kohaku-eth/social-recovery": patch
---

Add the internal `formats` module's digest half: the credential commitment, the setup body codec, the setup body hash and the setup commitment (all `abi.encode`), and the EIP-712 `Approval` and `Cancellation` typed data and digests under the `PolicyManager` domain. Adds `viem` as a dependency.
