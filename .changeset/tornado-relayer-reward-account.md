---
"@kohaku-eth/tornado-cash": patch
---

A relayer whose `/status` reports a `rewardAccount` that is not a nonzero address is now rejected before quotes are ranked. Before, it could win on price and make preparation fail when proving, without trying the other relayers.
