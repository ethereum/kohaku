---
"@kohaku-eth/provider": patch
---

Report HTTP error statuses from the Helios `eth_getLogs` bypass instead of a JSON
parse error or a missing result, and give a clear error for a successful response
that carries an error without a message or no log array.
