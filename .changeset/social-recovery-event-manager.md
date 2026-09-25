---
"@kohaku-eth/social-recovery": patch
---

Add `EventManager`, the shipped `IEventManager`: the per-account, method and privilege filters, a chunked `fetch` through the integrator's provider, and `decodeLog` for the kit's fourteen events, with the hand-written event ABI it decodes against. Adds `viem` as a dependency.
