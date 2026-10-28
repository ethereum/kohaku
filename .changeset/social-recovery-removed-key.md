---
"@kohaku-eth/social-recovery": patch
---

Add `inferRemovedKey`, which names the key a handover removes from a supplied address, the latest consumed handover or the signer of the latest setup commit, each confirmed through `isAuthority`; add the provider's `transaction` read, the `RawTransaction` record and the `ISignerRecovery` interface; replace the removed key's unnamed values with `no-source`, `not-a-key` and `unread`.
