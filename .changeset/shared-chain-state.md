---
"@kohaku-eth/privacy-pools": patch
---

feat: let accounts share one copy of the chain state through `chainStorage`, and export the storage key builders. The plugin no longer saves anything per account: history timestamps are shared with the chain state, and exact metadata saved by older versions is no longer used. States saved by earlier versions are dropped and synced again.
