---
"@kohaku-eth/tornado-cash": patch
---

Ignore secret slices in public initialState checkpoints and exclude imported legacy secrets from the public snapshot type. Private host.storage snapshots keep restoring imported notes with the existing keys and format. Document that hosts must isolate private storage between wallets/accounts whose imports must stay separate.
