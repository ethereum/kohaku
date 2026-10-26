---
"@kohaku-eth/provider": patch
"@kohaku-eth/privacy-pools": patch
---

`TxLog` now carries an optional `logIndex`, filled in by the ethers, viem and raw adapters (and so helios and colibri) and by the privacy-pools saga log source. Synced privacy-pools events store their real log index.
