---
"@kohaku-eth/tornado-cash": patch
---

fix: two correctness fixes in tornado-cash

- `state-manager`: parenthesize the relayer-config ternary so a caller-supplied `relayerConfig` is honored. `??` binds tighter than `?:`, so `relayerConfig ?? chainId === 1n ? A : B` discarded the provided config and always used the mainnet default.
- `isPoolRootValid`: encode the `bytes32` pool root with a fixed 32-byte width (`toHex(root, { size: 32 })`). A minimal-width hex made viem's ABI encoder throw `AbiEncodingBytesSizeMismatchError` (bytes1 vs bytes32) for any root narrower than 32 bytes, so the call threw instead of returning a result. Adds a regression test.
