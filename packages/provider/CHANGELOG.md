# @kohaku-eth/provider

## 0.1.0-alpha.14

### Patch Changes

- d8bf680: `history()` now takes the transaction hash and log index from the bulk sync instead of fetching the logs and header of each event's block (`TxLog` carries an optional `transactionHash`, filled in by the ethers, viem and raw adapters) and interpolates timestamps between headers fetched at a fixed 32768-block grid. Events from the root saga index (the `/v2` index carries hashes) or from a state synced before this change report `transactionHash` `0n`, and timestamps are estimates (on mainnet usually within a minute); exact metadata already cached by the previous version is kept.
- d8bf680: `TxLog` now carries an optional `transactionHash`, filled in by the ethers, viem and raw adapters and by the privacy-pools saga log source. The saga source requires `@saga-sync/client@^0.3.0` and the `/v2` publication (`https://saga-pp-state.global.ssl.fastly.net/v2`) to get hashes; synced privacy-pools events then store their real `transactionHash` instead of `0n`.

## 0.1.0-alpha.13

### Patch Changes

- 6e0e549: Add configurable receipt polling to raw, Helios and Colibri providers and use
  the shared waiting logic for the anon provider. Existing polling and timeout
  defaults remain unchanged, including anon's 4-second / 5-minute defaults.
  Waiting now rejects at the configured deadline even if a receipt request
  stalls, and clears its own timers on success, failure or timeout. In-flight
  RPC requests cannot be cancelled by this provider interface.
  The anon timeout message now uses the shared `Timed out waiting for transaction`
  format. Receipt waiting continues to mean inclusion, not successful execution
  or a configurable number of confirmations.

## 0.1.0-alpha.12

### Patch Changes

- 2b67d9a: `TxLog` now carries an optional `logIndex`, filled in by the ethers, viem and raw adapters (and so helios and colibri) and by the privacy-pools saga log source. Synced privacy-pools events store their real log index.

## 0.1.0-alpha.11

### Minor Changes

- 4c5e47b: Add anon-rpc provider backend: wraps a hash-pinned, sandboxed anon-rpc worker
  (https://github.com/privacy-ethereum/anon-rpc) as an EthereumProvider via a new
  `@kohaku-eth/provider/anon` entry point. Browser-only proof of concept.
  `waitForTransaction` polls with Tor-sized defaults (4s interval, 5 minute
  timeout), configurable through `AnonConfig.waitForTransaction`.

## 0.1.0-alpha.10

### Patch Changes

- e3735d4: Upgrade the `@corpus-core/colibri-stateless` peer dependency range to `>=3.0.0 <4`.

  Colibri v3 ships its own TypeScript declarations and extends the Config interface with new fields (e.g. `oblivious_nodes`, `logs_completeness`, `max_latest_age_seconds`). The public API used by the provider (the default `C4Client` constructor and `request()`) remains backwards-compatible.

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
