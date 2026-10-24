---
"@kohaku-eth/privacy-pools": patch
"@kohaku-eth/provider": patch
---

`history()` now takes the transaction hash and log index from the bulk sync instead of fetching the logs and header of each event's block (`TxLog` carries an optional `transactionHash`, filled in by the ethers, viem and raw adapters) and interpolates timestamps between headers fetched at a fixed 32768-block grid. Events from a saga source or from a state synced before this change report `transactionHash` `0n`, and timestamps are estimates (on mainnet usually within a minute); exact metadata already cached by the previous version is kept.
