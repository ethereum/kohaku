---
"@kohaku-eth/social-recovery": patch
---

`RemovedKey` names why no key could be named (`REMOVED_KEY_UNNAMED`: no creation triple, no key entry, several key entries, a failed read), and `SetupConfirmation` gains an optional `cause` (`NOT_LANDED_CAUSES`: no event yet, or an event with another commitment) present when `landed` is false.
