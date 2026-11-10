---
"@kohaku-eth/privacy-pools": patch
---

fix: don't report a paymaster withdrawal as not sent when only the send response was lost. When `eth_sendUserOperation` fails, the broadcaster asks the bundler whether it knows the userOp. It reports `not-accepted` only if the bundler answered the send with an error. If the send got no answer, e.g. a timeout, it reports `unconfirmed` with the hash, because some bundlers only know mined userOps. The send is no longer retried, since a retry is rejected like an invalid userOp. Paymaster withdrawal payloads now carry the `userOpHash` computed at signing.
