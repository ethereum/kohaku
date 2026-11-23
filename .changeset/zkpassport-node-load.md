---
"@kohaku-eth/social-recovery": patch
---

The default zkPassport stack now loads in Node. The ESM build of `@zkpassport/sdk` 0.17.1 imports `buffer/`, a directory specifier that the ESM resolver of every supported Node refuses with `ERR_UNSUPPORTED_DIR_IMPORT`, so outside a bundler the default stack never loaded: `configFrom` and `replyFrom` answered `device-unavailable` and `openRequest()` rejected. Where `process.getBuiltinModule` is a function, the default stack now also loads the peer's CommonJS build through `createRequire`, before the ESM import, because after that refusal Node no longer requires the ES modules the failed import left half loaded (`ERR_REQUIRE_ESM_RACE_CONDITION`). It answers from that build only when the ESM import fails with `ERR_UNSUPPORTED_DIR_IMPORT`, and rethrows any other import failure unchanged. Browsers and bundlers, which resolve `buffer/` themselves, take the ESM build as before, and the built entry names no `node:` module. The CommonJS build needs `require()` of ES modules, unflagged from Node 22.12. The stack is still loaded on first use only, and an injected `stack` loads nothing. No export, type, record or closed set changes.

Breaking: the package's `engines.node` narrows from `>=22` to `>=22.12`. On Node 22.0 to 22.11 the default stack still answers `device-unavailable`.

Compatibility: in Node the first use of the default stack evaluates the peer's CommonJS build, then attempts the ESM import, which fails there as before; when a bundle makes that import succeed, its ESM build is used and the CommonJS one is left unused.
