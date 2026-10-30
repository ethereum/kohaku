---
"@kohaku-eth/social-recovery": patch
---

Add `PolicyManager`, the shipped `IPolicyManagerInteractor` and `IMethodModuleReads`: the manager's six writes as prepared calls pinned to the read tag's block, its seven views decoded into the SDK's records, and the three method module reads that tell a provider that failed from a module that replied, with `POLICY_METHOD_INTERFACE_ID` and the hand-written ABI it encodes and decodes against. Add `ProviderRevert` and `isProviderRevert`, the record an integrator's provider rejects a reverted call with. The manager and recovery action error tables now carry the deployed contracts' error names (`PolicyManager_*`, `RecoveryAction_*`), so `KitError.name` carries the prefixed name; `ReservedAuthority` is removed and `RecoveryAction_NotAKey` and `RecoveryAction_AlreadyPrivileged` are added.
