---
"@kohaku-eth/privacy-pools": patch
---

Paymaster fee quotes now price the notes a batch withdrawal spends. `estimateUnshield` takes `batch` and prices each note after the first as an execution-phase withdrawal, as the built operation does; before, it always priced a single note. Exact-output paymaster withdrawals with `batch: true` reprice until the fee-inclusive gross spends no more notes than its fee covers, so a request whose fee pushes the gross over a note boundary is no longer rejected with `PPv1ExactOutputError`.
