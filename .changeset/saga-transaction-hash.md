---
"@kohaku-eth/provider": patch
"@kohaku-eth/privacy-pools": patch
---

`TxLog` now carries an optional `transactionHash`, filled in by the ethers, viem and raw adapters and by the privacy-pools saga log source. The saga source requires `@saga-sync/client@^0.3.0` and the `/v2` publication (`https://saga-pp-state.global.ssl.fastly.net/v2`) to get hashes; synced privacy-pools events then store their real `transactionHash` instead of `0n`.
