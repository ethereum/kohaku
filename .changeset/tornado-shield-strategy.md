---
"@kohaku-eth/tornado-cash": patch
---

`prepareShield` now honours `{ strategy: DepositStrategy.MaxAnonimitySet }`. The enum value is `0`, which was replaced by `MinFee` as a falsy value.
