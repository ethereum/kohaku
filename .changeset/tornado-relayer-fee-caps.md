---
"@kohaku-eth/tornado-cash": patch
---

Bound the relayer fee before proving a relayer withdrawal. For ERC-20 pools the relayer's token price may not put the network fee more than `relayerConfig.maxPriceDeviationBps` (default 20%) above the paymaster's on-chain TWAP quote, and every note's total fee is capped at `relayerConfig.maxTotalFeeBps` (default 20%) of its denomination. The relayer is now chosen by lowest total fee, and each relayer withdrawal exposes the proven `fee` and the note `denomination`.
