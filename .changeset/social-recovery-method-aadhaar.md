---
"@kohaku-eth/social-recovery": patch
---

Add the Aadhaar recovery method under the `./recovery-methods` entry: `anonAadhaarMethod()` returns the `IRecoveryMethod` for `method-aadhaar`, with its config and proof codec, the digest-to-signal-hash reduction, and proving and local verification through the optional peer `@anon-aadhaar/core` 2.4.3, which is loaded on first use and can be swapped for an injected stack.
