## 0.1.0-alpha.31

### Patch Changes

- 33529e2: feat: new paymaster format

## 0.1.0-alpha.30

### Patch Changes

- ad9c520: Pin the Tornado proving artifacts. The prover now checks the circuit JSON and proving key against SHA-256 pins before parsing them, whatever `artifactsLoader` returns, and throws `TornadoArtifactsIntegrityError` on a mismatch. The default loader now fetches from a fixed tornado-cli commit and fails on HTTP errors. The pins are exported as `TORNADO_CIRCUIT_SHA256` and `TORNADO_PROVING_KEY_SHA256`.
- 3cf4609: Narrow what the state worker can do with host objects. They used to cross as plain comlink `proxy()`s, which answer on any property path. Each host object now gets its own channel that only accepts calls to the methods the worker uses, with plain-data arguments: read-only `provider.request` methods, `tornado-cash-` storage keys, and a keystore scoped to `m/29795'/1'` plus the exact `delegation.path` of an unshield. A custom `secretManagerFactory` receives that scoped keystore too.
- 70b93ba: Only deposit into known Tornado instances. Pool addresses and denominations read from the RPC are now checked against a static per-chain catalog (`TornadoInstances`, mainnet and Sepolia); pools that are missing from it or disagree with it are ignored on sync and dropped from saved state on load. `protocolConfig.instances` replaces the catalog for a chain, and on a chain with neither `prepareShield` throws.
- 70b93ba: Bound the relayer fee before proving a relayer withdrawal. For ERC-20 pools the relayer's token price may not put the network fee more than `relayerConfig.maxPriceDeviationBps` (default 20%) above the paymaster's on-chain TWAP quote, and every note's total fee is capped at `relayerConfig.maxTotalFeeBps` (default 20%) of its denomination. The relayer is now chosen by lowest total fee, and each relayer withdrawal exposes the proven `fee` and the note `denomination`.
- 70b93ba: `prepareShield` now honours `{ strategy: DepositStrategy.MaxAnonimitySet }`. The enum value is `0`, which was replaced by `MinFee` as a falsy value.
- Updated dependencies [3cf4609]
  - @kohaku-eth/plugins@0.0.1-alpha.19

## 0.1.0-alpha.29

### Patch Changes

- a684e89: chore: add sep 10 eth pools

## 0.1.0-alpha.28

### Patch Changes

- Updated dependencies [6e0e549]
  - @kohaku-eth/provider@0.1.0-alpha.13
  - @kohaku-eth/plugins@0.0.1-alpha.18

## 0.1.0-alpha.27

### Patch Changes

- bf65511: fix: bind chainId in sig domain

## 0.1.0-alpha.26

### Minor Changes

- a05e246: tornado signature based derivation
- a05e246: Add a signature-derived secret manager and use it for new deposits. Each note comes from one deterministic EIP-712 signature over a global nonce (`TornadoCashNote`), with the pool mixed in afterwards: the signature's canonical `(r, s)` (big-endian, low-s, recovery id `v` dropped) is hashed with the chain id and pool address into the nullifier and secret. The signing key is `m/29795'/1'/account'`.

  The legacy BIP-32 `SecretManager` stays in the default scan, so notes created under that scheme are still discovered. Imported note strings are unchanged.

## 0.0.2-alpha.25

### Patch Changes

- Updated dependencies [2b67d9a]
  - @kohaku-eth/provider@0.1.0-alpha.12
  - @kohaku-eth/plugins@0.0.1-alpha.17

## 0.0.2-alpha.24

### Patch Changes

- Updated dependencies [4c5e47b]
  - @kohaku-eth/provider@0.1.0-alpha.11
  - @kohaku-eth/plugins@0.0.1-alpha.16

## 0.0.2-alpha.23

### Patch Changes

- Updated dependencies [8676bb8]
  - @kohaku-eth/plugins@0.0.1-alpha.15

## 0.0.2-alpha.22

### Patch Changes

- Updated dependencies [e3735d4]
  - @kohaku-eth/provider@0.1.0-alpha.10
  - @kohaku-eth/plugins@0.0.1-alpha.14

## 0.0.2-alpha.21

### Patch Changes

- Updated dependencies [8d5a29e]
  - @kohaku-eth/provider@0.1.0-alpha.9
  - @kohaku-eth/plugins@0.0.1-alpha.13

## 0.0.2-alpha.20

### Patch Changes

- 66c603f: bump versions to latest
- Updated dependencies [66c603f]
  - @kohaku-eth/plugins@0.0.1-alpha.12

## 0.0.2-alpha.19

### Patch Changes

- 0d64c07: chore: preverification gas bump

## 0.0.2-alpha.18

### Patch Changes

- dfa61fe: feat: bump tornado base gas estimates

## 0.0.2-alpha.17

### Patch Changes

- 3ca504d: feat: multi-withdrawal on TC in one UserOp

## 0.0.2-alpha.16

### Patch Changes

- d86e4a1: feat: arbitrary delegator paths

## 0.0.2-alpha.15

### Patch Changes

- 9e8a25d: chore: add mainnet addrs to config

## 0.0.2-alpha.14

### Patch Changes

- e5aca8c: chore: bump for mimc-tree

## 0.0.2-alpha.13

### Patch Changes

- a3fc0f4: latest plugins
- Updated dependencies [a3fc0f4]
  - @kohaku-eth/plugins@0.0.1-alpha.11

## 0.0.2-alpha.12

### Patch Changes

- 30a64b7: feat: unified note by note api for plugins
- Updated dependencies [30a64b7]
  - @kohaku-eth/plugins@0.0.1-alpha.10

## 0.0.2-alpha.11

### Patch Changes

- 4bb7e64: fix: plugin iface has async host methods
- Updated dependencies [4bb7e64]
  - @kohaku-eth/plugins@0.0.1-alpha.9

## 0.0.2-alpha.10

### Patch Changes

- 472f4af: fix: two correctness fixes in tornado-cash

  - `state-manager`: parenthesize the relayer-config ternary so a caller-supplied `relayerConfig` is honored. `??` binds tighter than `?:`, so `relayerConfig ?? chainId === 1n ? A : B` discarded the provided config and always used the mainnet default.
  - `isPoolRootValid`: encode the `bytes32` pool root with a fixed 32-byte width (`toHex(root, { size: 32 })`). A minimal-width hex made viem's ABI encoder throw `AbiEncodingBytesSizeMismatchError` (bytes1 vs bytes32) for any root narrower than 32 bytes, so the call threw instead of returning a result. Adds a regression test.

## 0.0.2-alpha.9

### Patch Changes

- f36d197: bump tornado and railgun

## 0.0.2-alpha.0

### Patch Changes

- ecf8881: Introduce Tornado Cash
