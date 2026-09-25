---
"@kohaku-eth/provider": patch
---

Upgrade the `@corpus-core/colibri-stateless` peer dependency range to `>=3.0.0 <4`.

Colibri v3 ships its own TypeScript declarations and extends the Config interface with new fields (e.g. `oblivious_nodes`, `logs_completeness`, `max_latest_age_seconds`). The public API used by the provider (the default `C4Client` constructor and `request()`) remains backwards-compatible.
