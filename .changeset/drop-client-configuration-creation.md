---
"@kohaku-eth/social-recovery": patch
---

Drop the unused `creation` member from `ClientConfiguration`: the SDK never read it.

Breaking: the optional `ClientConfiguration.creation` member and the `CreationRecord` type are removed. A TypeScript integrator still writing `creation` in a configuration literal gets an excess-property compile error, and a missing-export error for `CreationRecord`. At run time the configuration check copies only the members it names, so a `creation` key still passed is silently ignored, neither checked nor kept on the client's configuration, where it was refused with a `TypeError` or `RangeError` when malformed before.
