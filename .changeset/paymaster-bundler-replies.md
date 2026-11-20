---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Paymaster broadcasting no longer trusts bundler replies as-is. Before, a malformed or mismatched reply could be reported as an accepted or mined withdrawal. The send must now answer with the signed userOp hash; an `eth_getUserOperationByHash` result counts only for the same EntryPoint with every signed field and the signature of this userOp, and no signed field it was not sent with, so a different userOp pending with the same nonce does not count; and a receipt counts only for the same userOp, with a boolean `success` and a transaction hash; a receipt in a reverted bundle transaction, or one without a status, is rejected whether it reports success or a revert. Anything else is `unconfirmed`.
