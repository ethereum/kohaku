---
"@kohaku-eth/privacy-pools": patch
---

fix: don't report a paymaster withdrawal as not sent when only the send response was lost. When `eth_sendUserOperation` fails, the broadcaster asks the bundler whether it knows the userOp before reporting `not-accepted`. Paymaster withdrawal payloads now carry the `userOpHash` computed at signing.
