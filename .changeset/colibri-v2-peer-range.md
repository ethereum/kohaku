---
"@kohaku-eth/provider": patch
---

Widen the `@corpus-core/colibri-stateless` peer dependency range to `>=1.1.22 <3` so Colibri v2 is accepted.

Colibri v2 switches to the 64-bit SP1 v6 zk-proofs, which are a breaking change. The old SP1 v5 zk-proofs are still generated in parallel for some time, but adopting v2 ensures we can shut down the v5 provers as soon as possible.

The public API used by the provider (the default `Colibri` constructor and `Config`) is unchanged between v1 and v2.
