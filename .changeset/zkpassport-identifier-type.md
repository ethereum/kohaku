---
"@kohaku-eth/social-recovery": patch
---

Every zkPassport request now asks for the non-salted unique identifier, the only type the module accepts. The `openRequest` of `enrollInput` and of `signingInput` passes `uniqueIdentifierType` set to the new constant `METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE` (`0`, `NullifierType.NON_SALTED` of `@zkpassport/sdk`) to the stack's `request`, with dev mode on or off, so the request URL carries `nt=0` instead of leaving the type to the app. The peer's own verification then refuses a proof of another type, and counts the dev-mode fake passport's mock type as non-salted. `ZkPassportRequestArgs` gains the required member `uniqueIdentifierType`, typed as that constant. Nothing else in the request changes, and the method's local checks of the proof's nullifier type, with `METHOD_ZKPASSPORT_NON_SALTED_NULLIFIER`, are unchanged.

Compatibility: an injected `stack` now receives `uniqueIdentifierType: 0` among its `request` arguments, and code that builds a `ZkPassportRequestArgs` itself must add the member before it compiles again. How the zkPassport app answers `nt=0`, with a real document and in dev mode, is a manual check outside the SDK's tests.
