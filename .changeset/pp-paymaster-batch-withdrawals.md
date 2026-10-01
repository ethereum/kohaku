---
"@kohaku-eth/privacy-pools": patch
---

Add batch withdrawals for the paymaster flow. `prepareUnshield` gains a `batch` option (paymaster mode only): when set, multiple approved notes are consolidated to reach the requested amount in a single sponsored userOp. The largest note is sponsored and pays the gas fee; the remaining notes run as direct `pool.withdraw` calls (processor = sender, no fee), with the consolidated balance (minus fee) forwarded to the recipient — or routed through the caller's `tailCalls` when supplied. Gas is sized for the batch (`reasonableGasUnitsForBatch`, accounting for the extra withdraws and any execution phase) and refined against the bundler. Ignored for relayer withdrawals.
