---
"@kohaku-eth/provider": patch
---

Add configurable receipt polling to raw, Helios and Colibri providers and use
the shared waiting logic for the anon provider. Existing polling and timeout
defaults remain unchanged, including anon's 4-second / 5-minute defaults.
Waiting now rejects at the configured deadline even if a receipt request
stalls, and clears its own timers on success, failure or timeout. In-flight
RPC requests cannot be cancelled by this provider interface.
The anon timeout message now uses the shared `Timed out waiting for transaction`
format. Receipt waiting continues to mean inclusion, not successful execution
or a configurable number of confirmations.
