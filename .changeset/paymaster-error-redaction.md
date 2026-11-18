---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Bundler-provided text in `PaymasterBroadcastError` messages, including revert reasons, is bounded and has hex longer than a 32-byte hash elided, so a bundler that echoes the signed operation cannot carry it into errors documented as safe to report.
