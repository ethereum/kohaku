---
"@kohaku-eth/privacy-pools": patch
---

Use only the leaves from the association-set service. Sync rebuilds the ASP root from the leaves and rejects the set unless it matches the `RootUpdated` root (leaves outside the SNARK field are rejected too), and the on-chain check verifies that rebuilt root instead of the one the service reported. Withdrawals now refuse to prove unless the ASP proof's root equals the root matched to the Entrypoint's `latestRoot()` in this session.
