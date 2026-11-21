---
"@kohaku-eth/privacy-pools": patch
---

fix: keep the signed userOp out of bundler gas estimation errors. Preparing a paymaster withdrawal could throw viem's error, whose message includes the request body, which is the signed userOp. The error now has only the bundler's reason.
