---
'@kohaku-eth/plugins': minor
'@kohaku-eth/tornado-cash': minor
---

Expose which amounts can actually be unshielded. `balance()` entries may carry a `spendable` field: `continuous` (any amount up to `max`) or `discrete` (any sum of `count` notes of each `amount`). Wallets can check input with the new `isSpendable`, `nearestSpendable` and `solveSpendable` helpers before preparing an unshield. Tornado Cash fills `spendable` with its denomination units, and `prepareUnshield` now throws `UnreachableAmountError` (with the nearest reachable amounts) when no notes add up to the amount, or `InsufficientBalanceError` when it exceeds the total.
