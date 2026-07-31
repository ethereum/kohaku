---
"@kohaku-eth/railgun": minor
"@kohaku-eth/plugins": patch
---

Railgun `prepareUnshield` / `prepareUnshieldMulti` accept `UnshieldOptions.tailCalls`. Broadcast composes WETH unwrap (native only) before user tails; no Tornado-style leftover-forward baking — funds already land at `to` via the privacy paymaster.
