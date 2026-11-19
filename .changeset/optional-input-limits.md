---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Bound Tornado's worker bundler bridge responses at 10 MiB, matching viem's existing limit before copying the body. Bound ASP review responses at 16 MiB, 100 rows per page and 78 digits per decimal field. Streaming hosts are checked while reading; text-only hosts are checked after reading.

Limit Tornado shield preparations and legacy note imports to 1,000 notes per call. Reject note strings above 1,024 characters and require the exact 62-byte preimage before decoding. Parser errors no longer echo private note strings. Larger shield/import requests can be split into separate calls.
