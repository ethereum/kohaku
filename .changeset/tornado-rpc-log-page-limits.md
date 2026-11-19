---
"@kohaku-eth/tornado-cash": patch
---

Limit RPC log pages to 10,000 logs and 4 Mi characters across log string fields before accumulating or ABI-decoding them. Oversized pages retry with a smaller block range; a single block exceeding the limits fails the scan without truncating history. Pages cover consecutive blocks without overlapping their boundaries.

The host provider still owns raw HTTP response limits, since it returns already-parsed logs to the SDK.
