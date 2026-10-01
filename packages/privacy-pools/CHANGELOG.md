# @kohaku-eth/privacy-pools

## 0.0.2-alpha.21

### Patch Changes

- f829ce1: Add cost estimation and exact-output unshields. New `estimateShield` and `estimateUnshield` methods return the fees and net amounts for a shield/withdrawal without building a proof. `prepareUnshield` gains an `exact` option: when set, `amount` is read as the amount the recipient must receive (net). For relayer withdrawals the recipient receives that amount exactly. The quote is decomposed into its fixed base rate and its (size-independent) gas cost; the gross is sized from that and a fee is embedded in self-built relay data. Only the gas component is bumped by `exact.gasBumpBPS` (default 15%) to keep the payload acceptable if gas rises before submission — the relayer's base margin is not inflated. The required fee is bounded by the asset's on-chain `maxRelayFeeBPS`; the withdrawal is rejected if it would exceed the cap. Exact-output relayer payloads are broadcast without a `feeCommitment`, since the embedded fee is not one the relayer signed.

## 0.0.2-alpha.20

### Patch Changes

- 6929569: Add optional `devOptions` to the plugin constructor to toggle Redux dev-mode checks. The immutable- and serializable-state-invariant middleware is slow on large privacy-pool states, so both checks are now off by default; opt back in per check via `devOptions: { enableImmutableCheck: true, enableSerializableCheck: true }`.

## 0.0.2-alpha.19

### Patch Changes

- Updated dependencies [4c5e47b]
  - @kohaku-eth/provider@0.1.0-alpha.11
  - @kohaku-eth/plugins@0.0.1-alpha.16

## 0.0.2-alpha.18

### Patch Changes

- Updated dependencies [8676bb8]
  - @kohaku-eth/plugins@0.0.1-alpha.15

## 0.0.2-alpha.17

### Patch Changes

- Updated dependencies [e3735d4]
  - @kohaku-eth/provider@0.1.0-alpha.10
  - @kohaku-eth/plugins@0.0.1-alpha.14

## 0.0.2-alpha.16

### Patch Changes

- Updated dependencies [8d5a29e]
  - @kohaku-eth/provider@0.1.0-alpha.9
  - @kohaku-eth/plugins@0.0.1-alpha.13

## 0.0.2-alpha.15

### Patch Changes

- 66c603f: bump versions to latest
- Updated dependencies [66c603f]
  - @kohaku-eth/plugins@0.0.1-alpha.12

## 0.0.2-alpha.14

### Patch Changes

- a3fc0f4: latest plugins
- Updated dependencies [a3fc0f4]
  - @kohaku-eth/plugins@0.0.1-alpha.11

## 0.0.2-alpha.13

### Patch Changes

- 30a64b7: feat: unified note by note api for plugins
- Updated dependencies [30a64b7]
  - @kohaku-eth/plugins@0.0.1-alpha.10

## 0.0.2-alpha.12

### Patch Changes

- 4bb7e64: fix: plugin iface has async host methods
- Updated dependencies [4bb7e64]
  - @kohaku-eth/plugins@0.0.1-alpha.9

## 0.0.2-alpha.11

### Patch Changes

- 0c165e7: Add minimal `demo/simple.ts` script referenced by the `pnpm demo` package script.
  The script derives a deposit precommitment from a mnemonic and encodes the
  corresponding shield transaction (no network calls, no broadcast).

## 0.0.2-alpha.10

### Patch Changes

- Updated dependencies [506bb2f]
  - @kohaku-eth/provider@0.1.0-alpha.8
  - @kohaku-eth/plugins@0.0.1-alpha.8

## 0.0.2-alpha.9

### Patch Changes

- d1335e9: Added Mainnet tests and small fixes

## 0.0.2-alpha.8

### Patch Changes

- 3587a82: bump all pkg alpha releases to test pipeline
- Updated dependencies [3587a82]
  - @kohaku-eth/plugins@0.0.1-alpha.7
  - @kohaku-eth/provider@0.1.0-alpha.7

## 0.0.2-alpha.7

### Patch Changes

- Updated dependencies [00db9b6]
  - @kohaku-eth/provider@0.1.0-alpha.6
  - @kohaku-eth/plugins@0.0.1-alpha.6

## 0.0.2-alpha.6

### Patch Changes

- 83aed07: Use snapshot state only if there's no previous stored state

## 0.0.2-alpha.5

### Patch Changes

- 5383533: Expose option for providing an initial state for Privacy Pools V1 Plugin

## 0.0.2-alpha.4

### Patch Changes

- 20fa0c9: Optimized test filtering for ci/cd
- Updated dependencies [20fa0c9]
  - @kohaku-eth/provider@0.1.0-alpha.5
  - @kohaku-eth/plugins@0.0.1-alpha.5

## 0.0.2-alpha.3

### Patch Changes

- Updated dependencies [88b2cbb]
  - @kohaku-eth/provider@0.1.0-alpha.4
  - @kohaku-eth/plugins@0.0.1-alpha.4

## 0.0.2-alpha.2

### Patch Changes

- Updated dependencies [42607db]
  - @kohaku-eth/provider@0.1.0-alpha.3
  - @kohaku-eth/plugins@0.0.1-alpha.3

## 0.0.2-alpha.1

### Patch Changes

- 21e550e: Update broadcastfn & privacy-pools v1 asp
- Updated dependencies [21e550e]
  - @kohaku-eth/plugins@0.0.1-alpha.2

## 0.0.2-alpha.0

### Patch Changes

- ecf8881: Introduce privacy pools v1
