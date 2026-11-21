---
"@kohaku-eth/privacy-pools": patch
---

When a protected batch's random sponsor slice cannot cover its paymaster fee, randomly increase that slice while retaining at least 1% change and reduce the other slices without changing the gross amount. Rebuild simulated direct withdrawals after any adjustment and reuse the allocation for the final proofs. Fees exceeding the sponsoring note's protected capacity still fail.
