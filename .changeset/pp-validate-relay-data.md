---
"@kohaku-eth/privacy-pools": patch
---

Validate relayer withdrawal data before proving. Quotes are now dropped if they pay anyone other than the recipient, embed a fee above the quoted `feeBPS` or the pool's `maxRelayFeeBPS`, or use a non-canonical encoding. The remaining quotes are ranked by the fee in the data. Exact-output withdrawals encode the caller's recipient themselves, and cap the relayer's self-reported base rate at its embedded fee.
