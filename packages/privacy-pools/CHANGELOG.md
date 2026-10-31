# @kohaku-eth/privacy-pools

## 0.1.0-alpha.36

### Patch Changes

- e8cbe96: Build the state and ASP Merkle trees with `@kohaku-eth/poseidon-lean-imt` instead of `@zk-kit/lean-imt`, which is no longer a dependency. Trees of 2048 leaves or more are built from scratch on workers (`PoseidonT3LeanIMT.fromLeavesParallel`); smaller ones are still built in-thread, where starting the workers would cost more than the hashing. Root and proof derivation is now async: the in-process tree cache holds each tree's build as a promise, so concurrent callers share one build and appended leaves apply in order even while a build is in flight, and a failed build or insert is evicted instead of staying cached. A withdrawal fetches its state and ASP proofs concurrently. No persisted-state or public-API changes.
- Updated dependencies [e8cbe96]
  - @kohaku-eth/poseidon-lean-imt@0.0.1-alpha.0

## 0.1.0-alpha.35

### Minor Changes

- b7d4974: Add an optional `{ sync?: boolean }` (`PPv1ViewOptions`, default `true`) to
  `balance()`, `notes()` and `history()`, so integrators can sync once and read
  several times without re-syncing. Write methods still always sync.

  Fix concurrency issues when calls overlap on the same chain store:

  - `sync()` calls no longer overlap on the same store (overlapping syncs could
    append duplicate note secrets or briefly unset the verified ASP root during a
    withdrawal). A call made while a sync is running waits for one follow-up sync,
    shared with the other calls made meanwhile, so it always sees a head read after
    the call;
  - concurrent first calls share one store load instead of each building its own;
  - `addNoteSecrets` ignores note indexes the record already holds.

## 0.1.0-alpha.34

### Patch Changes

- a98a88f: Check paymaster bundler gas prices against the host RPC fee market, bound validation overhead and payload-sized pre-verification gas, and send bundler requests through the host network. Tail-call execution gas can grow with the bundler estimate; optional `maxGasLimits` sets explicit absolute ceilings. There is no percentage-of-withdrawal fee cap. The sponsoring note must still cover the fee. Tornado prepared paymaster payloads include the proof-bound fee and total withdrawn value, with optional fields for compatibility with older saved operations.
- d8bf680: `history()` now takes the transaction hash and log index from the bulk sync instead of fetching the logs and header of each event's block (`TxLog` carries an optional `transactionHash`, filled in by the ethers, viem and raw adapters) and interpolates timestamps between headers fetched at a fixed 32768-block grid. Events from the root saga index (the `/v2` index carries hashes) or from a state synced before this change report `transactionHash` `0n`, and timestamps are estimates (on mainnet usually within a minute); exact metadata already cached by the previous version is kept.
- d8bf680: The saga log source now returns only the requested block range. `@saga-sync/client` up to 0.3.0 uses the stream window only to pick chunks, so a `headBlock` clamp (a fork or a pinned view) still received events after it, whose leaves are not on that chain, and the pool root check failed the sync. It also re-sent every event before `fromBlock` on each sync, so an incremental sync took saga's last `RootUpdated` as the latest, replaced a newer ASP root already synced from the RPC, and failed the ASP root check.
- d8bf680: `TxLog` now carries an optional `transactionHash`, filled in by the ethers, viem and raw adapters and by the privacy-pools saga log source. The saga source requires `@saga-sync/client@^0.3.0` and the `/v2` publication (`https://saga-pp-state.global.ssl.fastly.net/v2`) to get hashes; synced privacy-pools events then store their real `transactionHash` instead of `0n`.
- Updated dependencies [d8bf680]
- Updated dependencies [d8bf680]
  - @kohaku-eth/provider@0.1.0-alpha.14
  - @kohaku-eth/plugins@0.0.1-alpha.20

## 0.1.0-alpha.33

### Patch Changes

- 799dddf: Add a `blockNumber` field to the `INote` abstraction, matching the block number
  of the note's deposit event.

## 0.1.0-alpha.32

### Patch Changes

- 68085b9: Use only the leaves from the association-set service. Sync rebuilds the ASP root from the leaves and rejects the set unless it matches the `RootUpdated` root (leaves outside the SNARK field are rejected too), and the on-chain check verifies that rebuilt root instead of the one the service reported. Withdrawals now refuse to prove unless the ASP proof's root equals the root matched to the Entrypoint's `latestRoot()` in this session.
- 3cf4609: The secret manager now gets a keystore scoped to `m/28784'/1'` plus the exact `delegation.path` of a paymaster unshield, instead of the host's whole keystore. A custom `secretManager` that derives other paths gets `KeystorePathNotAllowedError`. `PRIVACY_POOLS_KEYSTORE_PREFIX` is exported.
- 11ce788: `SignatureSecretManager` now checks that its signer is deterministic before handing out any note secret. Secrets are never stored and are re-derived from the signatures after a restart, so a signer that adds entropy (viem's `setSignEntropy(true)`, some custom signers) created deposits that could later be neither withdrawn nor ragequit. The first note envelope of each session is signed twice and derivation throws if the signatures differ; this costs one extra signature (one extra hardware prompt) per session and can be turned off with `verifyDeterminism: false`.
- 777a1b6: Sync now reads one chain head, scans the entrypoint and every pool up to it, and saves that head as the next sync point. Before, each scan read its own head and the last pool-event block was saved, so entrypoint deposits that landed between the two heads were skipped forever and the note dropped out of the balance. A failed pool scan now fails the sync instead of being skipped, the saga log source starts its RPC tail right after the block it served (it skipped blocks under a `headBlock` clamp), and custom `IDataService` implementations need a `getBlockNumber()` method.
- e29a619: Validate relayer withdrawal data before proving. Quotes are now dropped if they pay anyone other than the recipient, embed a fee above the quoted `feeBPS` or the pool's `maxRelayFeeBPS`, or use a non-canonical encoding. The remaining quotes are ranked by the fee in the data. Exact-output withdrawals encode the caller's recipient themselves, and cap the relayer's self-reported base rate at its embedded fee.
- Updated dependencies [3cf4609]
  - @kohaku-eth/plugins@0.0.1-alpha.19

## 0.1.0-alpha.31

### Patch Changes

- d57bc20: fix: poseidon lib

## 0.1.0-alpha.30

### Patch Changes

- Use Poseidon `0.0.1`, the published release containing its compiled runtime and type declarations, while retaining the `workspace:*` dependency convention.

## 0.1.0-alpha.29

### Patch Changes

- 1ae32b7: feat: optimized poseidon

## 0.1.0-alpha.28

### Patch Changes

- 02d8e4a: Expose `depositor` on `INote`. The field is picked from the underlying deposit event and populated by the note selectors; it is inherited across withdrawals since a note keeps a single depositor for its lifetime (withdrawals only reduce its balance).
- Updated dependencies [6e0e549]
  - @kohaku-eth/provider@0.1.0-alpha.13
  - @kohaku-eth/plugins@0.0.1-alpha.18

## 0.1.0-alpha.27

### Patch Changes

- 7f07a77: Set the withdraw proof's `stateTreeDepth` and `ASPTreeDepth` public signals to `32` to match the official Privacy Pools implementation.

  The circuit's Merkle siblings are already padded to the fixed depth of 32 (see `proofFromTree`), but the withdraw proof declared a tree depth of `2`. Emitting a tree-depth value that differs from the canonical Privacy Pools deployment makes our withdrawals stand out on-chain and would flag the withdrawing wallets. Using the same `32` value keeps our withdrawals indistinguishable from the rest of the pool's anonymity set.

## 0.1.0-alpha.26

### Patch Changes

- 4faf96e: Speed up `prepareUnshield` (paymaster flow) on an already-synced state by removing redundant Merkle and sync work:

  - Cache each pool's state tree and the ASP tree in-process and derive roots and inclusion proofs from the cached tree — building it once, then extending it incrementally with `LeanIMT.insert` — instead of rebuilding the whole tree (O(n) poseidon hashes) on every root check and every per-note proof. Nothing is added to Redux or the persisted snapshot; the cache is keyed per pool / per entrypoint with a leaf-count + last-leaf guard, and `verifyRootsThunk` still checks every derived root against chain.
  - Drop the redundant on-chain root re-verification in the paymaster withdrawal: the `sync()` the plugin runs immediately beforehand already verified the same, unchanged state against chain.
  - Run `verifyRootsThunk`'s on-chain root reads (ASP latest root + each pool's state root) concurrently instead of one at a time.
  - Skip no-op `registerPoolLeaves` dispatches for pools with no new leaves, avoiding a re-serialization of the entire cross-pool leaf structure per pool on every sync.

  No persisted-state or public-API changes. Measured on a mainnet fork (real bundler + prover): 3-note batch `prepareUnshield` ~45s → ~12s, 1-note ~19s → ~5s, with the remainder dominated by zk proving.

## 0.1.0-alpha.25

### Minor Changes

- 39cda9a: Add a signature-derived secret manager and make it the default. Note secrets are now derived from one deterministic EIP-712 signature per note instead of per-note BIP-32 HD keys: the signature's canonical `(r, s)` (big-endian, low-s normalized, recovery id `v` dropped) is hashed with per-role tags into the nullifier and salt, so derivation is identical across any compliant signer — software or hardware (Ledger-style `v‖r‖s`, viem `r‖s‖v`, and ERC-2098 compact signatures all converge). The signing identity is the shared account key at `m/28784'/1'/account'`.

  `SignatureSecretManager` is now the default `secretManager` for `PrivacyPoolsV1Protocol`; the legacy BIP-32 HD `SecretManager` is marked `@deprecated` but kept for explicit injection. Signers plug in at a narrow `EnvelopeSigner` seam (`signEnvelope`) so they can never diverge the typed-data standard.

  BREAKING: the two schemes derive disjoint notes, so the default change is a breaking derivation change — deposits created under the old default will not be rediscovered. Acceptable as the package is unreleased (alpha) with no real users; callers needing the old behavior can inject `SecretManager` explicitly.

## 0.0.2-alpha.24

### Patch Changes

- 2b67d9a: Add `history()` returning the account's deposits, withdrawals and ragequits, newest first. Transaction hashes, log indexes and timestamps are fetched on demand for the user's own events and cached in state.
- 2b67d9a: `TxLog` now carries an optional `logIndex`, filled in by the ethers, viem and raw adapters (and so helios and colibri) and by the privacy-pools saga log source. Synced privacy-pools events store their real log index.
- Updated dependencies [2b67d9a]
  - @kohaku-eth/provider@0.1.0-alpha.12
  - @kohaku-eth/plugins@0.0.1-alpha.17

## 0.0.2-alpha.23

### Patch Changes

- f691f09: Route the paymaster's postOp gas-overcharge refund (`fee - actualGasCost`) to the real recipient and expose it as an option. `PrivacyPoolsFeeAdapter.FeeData` gains a `refundRecipient` field (decoupled from the validation-phase payout `recipient`, which stays the sender in an execution-phase withdrawal), so the refund is no longer stranded on the ephemeral sender in batch/tail-call flows. `prepareUnshield` gains a `refundRecipient` option (paymaster mode only) defaulting to the recipient. `PPv1UnshieldOptions` is now a discriminated union on `mode`, so paymaster-only knobs (`delegation`, `batch`, `refundRecipient`) are a type error in relayer mode. Exact-output withdrawals in paymaster mode now require an explicit `refundRecipient` (the refund otherwise makes the recipient net more than the requested amount), and are documented as such.

## 0.0.2-alpha.22

### Patch Changes

- 92fb3a8: Add batch withdrawals for the paymaster flow. `prepareUnshield` gains a `batch` option (paymaster mode only): when set, multiple approved notes are consolidated to reach the requested amount in a single sponsored userOp. The largest note is sponsored and pays the gas fee; the remaining notes run as direct `pool.withdraw` calls (processor = sender, no fee), with the consolidated balance (minus fee) forwarded to the recipient — or routed through the caller's `tailCalls` when supplied. Gas is sized for the batch (`reasonableGasUnitsForBatch`, accounting for the extra withdraws and any execution phase) and refined against the bundler. Ignored for relayer withdrawals.

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
