---
"@kohaku-eth/tornado-cash": patch
---

Narrow what the state worker can do with host objects. They used to cross as plain comlink `proxy()`s, which answer on any property path. Each host object now gets its own channel that only accepts calls to the methods the worker uses, with plain-data arguments: read-only `provider.request` methods, `tornado-cash-` storage keys, and a keystore scoped to `m/29795'/1'` plus the exact `delegation.path` of an unshield. A custom `secretManagerFactory` receives that scoped keystore too.
