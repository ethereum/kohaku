---
"@kohaku-eth/privacy-pools": patch
---

Send relayer quote amounts as decimal strings and report HTTP failures before decoding quotes. Export `PPv1RelayerQuoteError` with per-relayer failures, including `fee-too-high`, `requiredFeeBPS`, and `maxRelayFeeBPS`, and preserve it through fee estimation and withdrawal preparation.
