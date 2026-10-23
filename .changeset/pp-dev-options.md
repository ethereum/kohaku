---
"@kohaku-eth/privacy-pools": patch
---

Add optional `devOptions` to the plugin constructor to toggle Redux dev-mode checks. The immutable- and serializable-state-invariant middleware is slow on large privacy-pool states, so both checks are now off by default; opt back in per check via `devOptions: { enableImmutableCheck: true, enableSerializableCheck: true }`.
