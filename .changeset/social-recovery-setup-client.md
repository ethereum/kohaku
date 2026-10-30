---
"@kohaku-eth/social-recovery": patch
---

Add `SetupClient`, the shipped `ISetupClient` over the policy manager, recovery action and event manager parts its caller builds: it validates and describes a setup draft, prepares the commit (with the arming write as one atomic batch while the action is not authorized, and the backup the draft's choice names) and the clear, confirms a commit landed, reads the setup state and restores the standing setup, each member pinning one block for every read it makes. An optional `versionEscaped` flag makes both prepares refuse. Add the `SetupClientRecoveryAction` type and the `SETUP_CLIENT_` refusal messages. Add the optional `tier` member to `IRecoveryMethod`, and the record guards `checkedDescriptor` and `checkedConfiguration`.
