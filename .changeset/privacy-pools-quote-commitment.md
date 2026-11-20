---
"@kohaku-eth/privacy-pools": patch
---

Relayer quotes are dropped before ranking when their fee commitment has expired or carries no signed commitment. Quotes are collected until every relayer has answered or for 5 seconds after the first valid one, and every quote is checked for expiry at the moment of ranking, so a relayer cannot win by answering late with a longer-lived quote after the others expire, and one that never answers no longer stalls the selection. Before, such a quote could win on price and fail at the relayer only after the withdrawal was proved. Exact-output withdrawals, which omit the commitment, still accept unsigned quotes.
