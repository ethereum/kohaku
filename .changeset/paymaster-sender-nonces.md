---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

When the bundler refuses a paymaster withdrawal, `broadcast()` checks whether the sender's EntryPoint nonce or EIP-7702 authorization nonce moved since the withdrawal was signed: the sender sent a transaction, or another withdrawal from the same sender landed first. If so, its `not-accepted` `PaymasterBroadcastError` carries `staleNonce` (`{ kind: 'entry-point' | 'authorization', signed, current }`, type `StaleSenderNonce`) and says to prepare the withdrawal again, so an app can re-prepare without parsing a generic bundler error.
