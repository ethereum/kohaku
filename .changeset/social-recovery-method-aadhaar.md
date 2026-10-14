---
"@kohaku-eth/social-recovery": patch
---

Add the Aadhaar recovery method under the `./recovery-methods` entry: `anonAadhaarMethod()` returns the `IRecoveryMethod` for `method-aadhaar`, with its config and proof codec, the digest-to-signal-hash reduction, and proving and local verification through the optional peer `@anon-aadhaar/core` 2.4.3, which is loaded on first use and can be swapped for an injected stack. `modules(descriptor)` answers no module where the deployment carries the zero address for the method.

New public exports, all from `./recovery-methods` (the core entry exports nothing new):
- function: `anonAadhaarMethod`
- types for an injected stack and the installed stack's options: `AnonAadhaarStack`, `AnonAadhaarArtifacts`, `AnonAadhaarMethodOptions`, `AadhaarArgsOptions`, `AadhaarProverArgs`, `AadhaarPcd`, `AadhaarStackProof`, `AadhaarGroth16`, `AadhaarProgress`, `AadhaarMaterial`
