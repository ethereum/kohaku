---
"@kohaku-eth/privacy-pools": patch
---

Add minimal `demo/simple.ts` script referenced by the `pnpm demo` package script.
The script derives a deposit precommitment from a mnemonic and encodes the
corresponding shield transaction (no network calls, no broadcast).
