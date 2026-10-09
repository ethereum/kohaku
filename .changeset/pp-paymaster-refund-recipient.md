---
"@kohaku-eth/privacy-pools": patch
---

Route the paymaster's postOp gas-overcharge refund (`fee - actualGasCost`) to the real recipient and expose it as an option. `PrivacyPoolsFeeAdapter.FeeData` gains a `refundRecipient` field (decoupled from the validation-phase payout `recipient`, which stays the sender in an execution-phase withdrawal), so the refund is no longer stranded on the ephemeral sender in batch/tail-call flows. `prepareUnshield` gains a `refundRecipient` option (paymaster mode only) defaulting to the recipient. `PPv1UnshieldOptions` is now a discriminated union on `mode`, so paymaster-only knobs (`delegation`, `batch`, `refundRecipient`) are a type error in relayer mode. Exact-output withdrawals in paymaster mode now require an explicit `refundRecipient` (the refund otherwise makes the recipient net more than the requested amount), and are documented as such.
