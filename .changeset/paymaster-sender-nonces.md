---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

When the bundler refuses a paymaster withdrawal, `broadcast()` checks whether the sender's EntryPoint nonce or EIP-7702 authorization nonce moved past the one the withdrawal was signed for (a lower reading, from a lagging provider, keeps the bundler's error): the sender sent a transaction, or another withdrawal from the same sender landed first. If so, its `not-accepted` `PaymasterBroadcastError` carries `staleNonce` (`{ kind: 'entry-point' | 'authorization', signed, current }`, type `StaleSenderNonce`) so an app can tell this case apart without parsing a generic bundler error. Another operation from the sender may have spent the same notes, so callers should confirm earlier outcomes and sync before preparing another withdrawal.
