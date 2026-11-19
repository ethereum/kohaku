---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

`PaymasterBroadcastError` messages, and Privacy Pools gas-estimation errors, no longer include bundler-provided text, including revert reasons. A bundler can echo the signed operation there in any form, so the messages only name the failure, with the JSON-RPC error code and the ERC-4337 `AAxx` code when present. A malformed revert reason no longer prevents a reverted operation from being reported as `reverted` with its transaction hash.
