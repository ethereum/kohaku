---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

A lost paymaster send response can now be recovered by hash for smart-account senders. Tornado Cash payloads carry `userOpHash`, and `serializedUserOperationHash` accepts a chain id and includes SimpleAccount deployment fields, which are part of the signed hash.
