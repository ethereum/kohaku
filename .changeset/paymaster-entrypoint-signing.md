---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Paymaster withdrawals are signed for the configured `entryPointAddress`. Before, the user operation was always signed for the standard EntryPoint v0.8 while being estimated and submitted for the configured one, so a custom EntryPoint was rejected by the bundler, and refused by an external signer scoped to it. `buildSignedUserOp` and `buildSignedTornadoUserOp` (and their simulation variants) now take a required `entryPointAddress`.
