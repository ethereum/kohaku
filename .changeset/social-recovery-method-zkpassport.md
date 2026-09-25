---
"@kohaku-eth/social-recovery": patch
---

Add the zkPassport recovery method under the `./recovery-methods` entry: `zkPassportMethod()` returns the `IRecoveryMethod` whose codec reads and writes the `method-zkpassport` config and proof layouts, binds the digest as the request's custom data, and reaches `@zkpassport/sdk` (an optional peer) only through an injectable constructor.
