# @kohaku-eth/provider

## 0.1.0-alpha.9

### Patch Changes

- 8d5a29e: Widen the `@corpus-core/colibri-stateless` peer dependency range to `>=1.1.22 <3` so Colibri v2 is accepted.

  Colibri v2 switches to the 64-bit SP1 v6 zk-proofs, which are a breaking change. The old SP1 v5 zk-proofs are still generated in parallel for some time, but adopting v2 ensures we can shut down the v5 provers as soon as possible.

  The public API used by the provider (the default `Colibri` constructor and `Config`) is unchanged between v1 and v2.

## 0.1.0-alpha.8

### Patch Changes

- 506bb2f: railgun native withdrawal, bump colibri

## 0.1.0-alpha.7

### Patch Changes

- 3587a82: bump all pkg alpha releases to test pipeline

## 0.1.0-alpha.6

### Patch Changes

- 00db9b6: new rust based railgun version + helios provider updates

## 0.1.0-alpha.5

### Patch Changes

- 20fa0c9: Optimized test filtering for ci/cd

## 0.1.0-alpha.4

### Minor Changes

- 88b2cbb: fix missing binding

## 0.1.0-alpha.3

### Minor Changes

- 42607db: republish, force bump

## 0.0.1-alpha.2

### Patch Changes

- 1664791: Updated dependencies
