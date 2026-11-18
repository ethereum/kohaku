---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Paymaster broadcasting no longer trusts bundler replies as-is. Before, a malformed or mismatched reply could be reported as an accepted or mined withdrawal. The send must now answer with the signed userOp hash; an `eth_getUserOperationByHash` result counts only for the same EntryPoint, sender and nonce; and a receipt counts only for the same userOp, with a boolean `success` and a transaction hash. Anything else is `unconfirmed`.
