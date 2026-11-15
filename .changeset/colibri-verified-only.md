---
"@kohaku-eth/provider": minor
---

The Colibri adapter fails closed by default. Unless `proofStrategy` is set, it now uses Colibri's `Strategy.VerifiedOnly`, so a response that cannot be proven is an error. Colibri's own default, `WarningWithFallback`, returns the unverified RPC answer with only a warning when verification fails. To keep the old behaviour, pass `proofStrategy: Strategy.WarningWithFallback`.
