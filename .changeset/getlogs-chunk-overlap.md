---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Split `eth_getLogs` scans into chunks of exactly `maxQuerySize` blocks. Ranges are inclusive, so each chunk used to span one block more than intended and every chunk boundary was fetched twice.
