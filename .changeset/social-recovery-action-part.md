---
"@kohaku-eth/social-recovery": patch
---

Add `AmbireActionCodec`, the strict codec of the Ambire recovery action's `Handover` payload, and `AmbireRecoveryAction`, the action part bound to one account and one action that reads the action's views over that account, answers `actionInfo()` with the `POLICY_ACTION_INTERFACE_ID` probe, and prepares the account's own `setAddrPrivilege` arming and disarming calls; export the `setAddrPrivilege` ABI fragment and its selector, the `ProviderRevert` record a provider rejects a reverted call with, and the `isProviderRevert` guard.
