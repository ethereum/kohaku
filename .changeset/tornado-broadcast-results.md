---
"@kohaku-eth/tornado-cash": patch
---

`broadcast()` no longer hides failed withdrawals or reorders results. Before, a failed relayer withdrawal was only logged with `console.warn` and left out of the resolved results, and results were grouped by mode, so they no longer matched the operation's withdrawals by position.

`broadcast()` now resolves with one response per withdrawal, in the operation's order. If any of several withdrawals fails, it rejects with the new `TornadoBroadcastError`, after trying the rest; its `results` holds every withdrawal's outcome in order, including the responses of those that were sent. An operation with a single withdrawal, including every paymaster operation, still throws that withdrawal's own error, such as `PaymasterBroadcastError`; `broadcast()` only ever rejects with an `Error`.

This changes behaviour for relayer unshields that spend several notes: a partial failure now rejects instead of resolving with fewer results.
