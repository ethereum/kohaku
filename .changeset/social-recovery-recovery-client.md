---
"@kohaku-eth/social-recovery": patch
---

Add `RecoveryClient` with its constructor, `events`, `initRecoveryGathering` and `initCancelGathering`: each init pins one block at the read tag, reads the manager's state, restores the configuration behind that reading, reads each rule method's stop and pause holder and whether each wallet guardian holds code, and seeds the gathering record; the opening init refuses while an attempt is waiting and on a handover the action would refuse, naming the removed key through `inferRemovedKey`, and the cancel init refuses while no attempt is waiting. Add the `RECOVERY_CLIENT_` refusal messages and `RECOVERY_CLIENT_NO_CODE`.
