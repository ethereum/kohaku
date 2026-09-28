---
"@kohaku-eth/privacy-pools": patch
---

Add cost estimation and exact-output unshields. New `estimateShield` and `estimateUnshield` methods return the fees and net amounts for a shield/withdrawal without building a proof. `prepareUnshield` gains an `exact` option: when set, `amount` is read as the amount the recipient must receive (net), the gross is sized to cover the fee, and the built operation is re-checked against the committed fee (with optional `slippageBPS` tolerance).
