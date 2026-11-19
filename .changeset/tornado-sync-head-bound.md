---
"@kohaku-eth/tornado-cash": patch
---

Use the head captured at the start of an event scan as the explicit RPC query bound. Empty relayer registry scans can no longer advance their cursor using a later, inconsistent head read. The shared pool scan path uses the same bound; a query failure leaves the cursor available for retry.
