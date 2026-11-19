---
"@kohaku-eth/privacy-pools": patch
---

Bound relayer responses to 64 KiB and apply deadlines through body reading: 30 seconds for quotes and fee lookups, three minutes for relay submission. Check HTTP status and require a valid success acknowledgement with a transaction hash, request ID and timestamp. Reject oversized withdrawal data before ABI decoding.

A relay acknowledgement is not a confirmed receipt. A timeout or invalid reply does not prove that submission failed; check the chain before resubmitting.
