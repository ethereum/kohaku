---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Only the exact `Already known` send rejection counts as a resend of an accepted paymaster operation. Before, any message containing "already known", such as "not already known", was reported as accepted; those are now `not-accepted`.
