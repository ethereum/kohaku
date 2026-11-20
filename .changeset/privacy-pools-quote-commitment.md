---
"@kohaku-eth/privacy-pools": patch
---

Relayer quotes are dropped before ranking when their fee commitment has expired or carries no signed commitment. Before, such a quote could win on price and fail at the relayer only after the withdrawal was proved. Exact-output withdrawals, which omit the commitment, still accept unsigned quotes.
