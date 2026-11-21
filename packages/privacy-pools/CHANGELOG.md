# @kohaku-eth/privacy-pools

## 0.1.0-alpha.41

### Patch Changes

- 5b92dd0: Privacy Pools ERC-20 shields now include the approval. `prepareShield` returned only the Entrypoint deposit, which reverts without a prior allowance, so a wallet sending the returned `txns` as-is could not shield ERC-20 tokens. The plan is now `approve(entrypoint, amount)` followed by the deposit. Native deposits are unchanged.

  For tokens whose `approve` reverts when changing one nonzero allowance to another (mainnet USDT), both packages first reset the allowance to zero. A leftover allowance, for example from a deposit that reverted after its approval, no longer blocks the next shield.

  Custom Privacy Pools state managers: `getDepositPayload` now returns `TxData[]`, the shield plan in order, instead of a single `TxData`.

- ac396bc: Split `eth_getLogs` scans into chunks of exactly `maxQuerySize` blocks. Ranges are inclusive, so each chunk used to span one block more than intended and every chunk boundary was fetched twice.
- 02ce3e2: Bound Tornado's worker bundler bridge responses at 10 MiB, matching viem's existing limit before copying the body. Bound ASP review responses at 16 MiB, 100 rows per page and 78 digits per decimal field. Streaming hosts are checked while reading; text-only hosts are checked after reading.

  Limit Tornado shield preparations and legacy note imports to 1,000 notes per call. Reject note strings above 1,024 characters and require the exact 62-byte preimage before decoding. Parser errors no longer echo private note strings. Larger shield/import requests can be split into separate calls.

- 86cba90: Only the exact `Already known` send rejection counts as a resend of an accepted paymaster operation. Before, any message containing "already known", such as "not already known", was reported as accepted; those are now `not-accepted`.
- 86cba90: Paymaster broadcasting no longer trusts bundler replies as-is. Before, a malformed or mismatched reply could be reported as an accepted or mined withdrawal. The send must now answer with the signed userOp hash; an `eth_getUserOperationByHash` result counts only for the same EntryPoint with every signed field and the signature of this userOp, and no signed field it was not sent with, so a different userOp pending with the same nonce does not count; and a receipt counts only for the same userOp, with a boolean `success` and a transaction hash; a receipt in a reverted bundle transaction, or one without a status, is rejected whether it reports success or a revert. Anything else is `unconfirmed`.
- e6e5038: Paymaster withdrawals are signed for the configured `entryPointAddress`. Before, the user operation was always signed for the standard EntryPoint v0.8 while being estimated and submitted for the configured one, so a custom EntryPoint was rejected by the bundler, and refused by an external signer scoped to it. `buildSignedUserOp` and `buildSignedTornadoUserOp` (and their simulation variants) now take a required `entryPointAddress`.
- 86cba90: `PaymasterBroadcastError` messages, and Privacy Pools gas-estimation errors, no longer include bundler-provided text, including revert reasons. A bundler can echo the signed operation there in any form, so the messages only name the failure, with the JSON-RPC error code (only an integer one) and the ERC-4337 `AAxx` code when present. A malformed revert reason no longer prevents a reverted operation from being reported as `reverted` with its transaction hash.
- 747e8fa: Paymaster fee quotes now price the notes a batch withdrawal spends. `estimateUnshield` takes `batch` and prices each note after the first as an execution-phase withdrawal, as the built operation does; before, it always priced a single note. Exact-output paymaster withdrawals with `batch: true` reprice until the fee-inclusive gross spends exactly the notes its fee covers, so a request whose fee pushes the gross over a note boundary is no longer rejected with `PPv1ExactOutputError`. With `obfuscateAmounts`, the random split that was priced is the one prepared, and an undeployed SimpleAccount sender's deployment gas is priced too.
- 6555ce9: Paymaster withdrawals with an execution phase (`tailCalls` or batched notes) no longer sign an unverified execution budget. Before, a zero `tailCallsGasEstimate` produced a `callGasLimit` of zero, and an unavailable bundler estimate fell back to baseline gas. Either way, the calls could run out of gas after the payout reached the sender, leaving the funds there.

  - `tailCallsGasEstimate` must be a positive bigint, in `prepareUnshield` and `estimateUnshield`.
  - An execution phase requires successful bundler estimation with a positive `callGasLimit`, and the refined limits are estimated again before the SDK proves and signs.
  - Single-note withdrawals without `tailCalls` keep the baseline fallback, since nothing runs after their payout.

- bb2d541: When the bundler refuses a paymaster withdrawal, `broadcast()` checks whether the sender's EntryPoint nonce or EIP-7702 authorization nonce moved past the one the withdrawal was signed for (a lower reading, from a lagging provider, keeps the bundler's error): the sender sent a transaction, or another withdrawal from the same sender landed first. If so, its `not-accepted` `PaymasterBroadcastError` carries `staleNonce` (`{ kind: 'entry-point' | 'authorization', signed, current }`, type `StaleSenderNonce`) so an app can tell this case apart without parsing a generic bundler error. Another operation from the sender may have spent the same notes, so callers should confirm earlier outcomes and sync before preparing another withdrawal.
- 8b1f9bc: Paymaster withdrawal preparation no longer sends an executable UserOperation to the bundler. Before, `eth_estimateUserOperationGas` received the signed operation with real proofs, so a bundler could submit it before `broadcast()`, even for a dry run or a declined confirmation.

  Gas estimation now uses a simulation payload: a dummy account signature, a dummy EIP-7702 authorization, and dummy Groth16 proofs with random nullifier (and, for Privacy Pools, commitment) hashes. This applies to the sponsoring note and to batched `withdraw` calls. State overrides make each pool's verifier run its real code at a shadow address and return `true`, so the estimate includes real verification gas plus about 3k. After the limits converge, the SDK proves each note and signs once, locally.

  - The configured bundler must support `eth_estimateUserOperationGas` state overrides (Pimlico and Alto do). Preparation reads each pool's verifier address and code from the host provider.
  - External and smart-account signers get one signature prompt, after estimation. Before, each refinement round needed a signature. An invalid or rejected signature now stops preparation after estimation instead of before.

- 6555ce9: Paymaster withdrawals call the `tailCalls` callback once per preparation and reuse its calls for every estimate and the signed operation. Before, the callback ran again on every rebuild, so a callback that answered differently could produce signed calls that were never estimated and run out of gas after the payout reached the sender.

  The callback must resolve to an array of `{ to, value, data }` calls with a valid address, a non-negative bigint `value` and hex `data`. Anything else stops preparation before estimation or proving. The SDK copies the calls, so later changes to the returned objects have no effect.

- 86cba90: A lost paymaster send response can now be recovered by hash for smart-account senders. Tornado Cash payloads carry `userOpHash`, and `serializedUserOperationHash` accepts a chain id and includes SimpleAccount deployment fields, which are part of the signed hash.
- 4f991b4: A paymaster unshield's `delegation.path` is now allowed on the scoped keystore only while that unshield is being prepared. Before, every path ever named stayed allowed for the life of the protocol instance, including invalid ones and those of failed preparations, and each key derivation scanned all of them.
- 4f991b4: Requires `@saga-sync/client` 0.4.0, which rejects a saga record whose `blockNumber` or `logIndex` is not minimal `0x`-hex or whose `logIndex` is past `Number.MAX_SAFE_INTEGER`. Up to 0.3.0 such a record reached the saga log source, where converting it threw outside any catch and failed every sync, since each sync streams the pool from block 0.
- 070ffb4: A sync on an RPC whose head is behind the last scanned head now leaves the state untouched, instead of pruning unfinalized events it cannot scan again or requesting an inverted block range, which real nodes reject. Pools are always scanned from the sync cursor rather than from the data source's reported registration block, so a forged registration block can no longer skip a pool's history.
- 2758845: Verify each pool's rebuilt state root against `currentRoot()` read at the synced block, instead of accepting any root in the Pool's recent history. A leaf stream missing its newest leaves, or all of them, now fails the sync rather than advancing the sync point past them: a pool with no stored leaves is checked as an empty tree. A stream with a hole in its leaf indices fails before any on-chain read. When the RPC's head is behind the sync point, nothing is scanned and only the ASP root is checked. `verifyStateRootOnChain` and `verifyRootsThunk` take the synced block number, `verifyRootsThunk` takes `verifyPoolRoots`, and `IDataService.getPoolStateRoot` accepts an optional block number.
- 6d6eccd: Relayer quotes are dropped before ranking when their fee commitment has expired or carries no signed commitment. Quotes are collected until every relayer has answered or for 5 seconds after the first valid one, and every quote is checked for expiry at the moment of ranking, so a relayer cannot win by answering late with a longer-lived quote after the others expire, and one that never answers no longer stalls the selection. Before, such a quote could win on price and fail at the relayer only after the withdrawal was proved. Exact-output withdrawals, which omit the commitment, still accept unsigned quotes.
- 5071d52: Bound relayer responses to 64 KiB and apply deadlines through body reading: 30 seconds for quotes and fee lookups, three minutes for relay submission. Check HTTP status and require a valid success acknowledgement with a transaction hash, request ID and timestamp. Reject oversized withdrawal data before ABI decoding.

  A relay acknowledgement is not a confirmed receipt. A timeout or invalid reply does not prove that submission failed; check the chain before resubmitting.

- 5022972: Sync drops everything after the last finalized block and scans it again, so a reorg can no longer leave events from an abandoned branch in the state. A state saved by an earlier version is rewound once, `LEGACY_REWIND_BLOCKS` below its saved head. Pool wind-downs are now recorded for pools registered in an earlier sync. `IDataService` gains `getFinalizedBlockNumber()`.
- ceda047: When a protected batch's random sponsor slice cannot cover its paymaster fee, randomly increase that slice while retaining at least 1% change and reduce the other slices without changing the gross amount. Rebuild simulated direct withdrawals after any adjustment and reuse the allocation for the final proofs. Fees exceeding the sponsoring note's protected capacity still fail.
- 9e15aa5: Scan and register pool events in batches of four instead of fetching and retaining every pool's results at once. Build event arrays with loops instead of spreading large arrays into function arguments. A failed batch still fails the sync without advancing its cursor; completed batches are pruned and replayed on retry as before.

  This limits concurrent pool scans and temporary cross-pool results; the size of an individual pool's response is unchanged.

- ac396bc: Only count a saga stream's events from the requested contract as that pool's leaves. A protocol's stream can carry several contracts' events, and one that decoded as the pool's `Deposited` or `Withdrawn` used to become a leaf and shift every later leaf index.

## 0.1.0-alpha.40

### Patch Changes

- 41eb489: Send relayer quote amounts as decimal strings and report HTTP failures before decoding quotes. Export `PPv1RelayerQuoteError` with per-relayer failures, including `fee-too-high`, `requiredFeeBPS`, and `maxRelayFeeBPS`, and preserve it through fee estimation and withdrawal preparation.
- Updated dependencies [a1d50c3]
  - @kohaku-eth/poseidon-lean-imt@0.0.1-alpha.2

## 0.1.0-alpha.39

### Minor Changes

- 7241ff4: Support compatible caller-selected EIP-7702 implementations and external typed-data-only owners of SimpleAccount v0.8 accounts, including factory deployment. Preserve sponsored withdrawal proof formats and paymasters, pin signing scopes, and avoid redundant forwarding when withdrawing a batch into its execution account.
- a83c847: fix: report paymaster withdrawal outcomes correctly. Paymaster `broadcast()` now resolves once the bundler accepts the userOp, and the returned `wait()` checks the receipt's `success`. Failures throw a `PaymasterBroadcastError` without the signed userOp. Custom `IPaymasterBroadcasterClient`s must return `wait()` instead of `txHash`, and reject instead of omitting failed withdrawals. `prepareUnshield` with `mode: 'paymaster'` now returns `PPv1PaymasterPrivateOperation`, so its broadcast result has `wait()` without narrowing.

### Patch Changes

- 0cd0a32: Keep working while the ASP service is down: `ragequit` no longer calls it, and a sync keeps the last good association set instead of failing. Withdrawals are refused until a sync gets the current set.
- 7241ff4: Preserve reuse of explicitly selected external and wallet-path EOAs without requiring `allowUsed: true`, including existing delegation to the selected implementation. Freshness checks remain the default for note-derived/random senders and smart accounts; explicit `allowUsed: false` also enforces them for wallet EOAs.

  Budget factory deployment gas only when the prepared account still needs deployment. For Tornado execution-gas retries, retain a successful probe's gas budget instead of trimming back to an estimate that can fail again.

- a83c847: fix: keep the signed userOp out of bundler gas estimation errors. Preparing a paymaster withdrawal could throw viem's error, whose message includes the request body, which is the signed userOp. The error now has only the bundler's reason.
- a83c847: fix: don't report a paymaster withdrawal as not sent when only the send response was lost. When `eth_sendUserOperation` fails, the broadcaster asks the bundler whether it knows the userOp, and treats an `Already known` answer as accepted. It reports `not-accepted`, with the hash, only if the bundler answered the send with another error. If the send got no answer, e.g. a timeout, it reports `unconfirmed` with the hash, because some bundlers only know mined userOps. The send is no longer retried. Paymaster withdrawal payloads now carry the `userOpHash` computed at signing; for payloads prepared before that, the broadcaster computes it from the signed userOp.
- 27cf0a7: Build Privacy Pools Merkle trees in the calling thread when workers are unavailable or fail, including Chrome MV3 service workers and React Native. Add an optional `merkleTreeBuilder` callback with async tree methods for offscreen/worker bridges, and clean up workers when a pool only partially starts.
- 9dd8f65: feat: expose each deposit's ASP review status (`pending`, `approved`, `declined`, `poi_required`) on notes and history, read from an opt-in `aspReviewServiceFactory` (`OxBowAspReviewService`)
- a83ec56: fix: time out the ASP tree (30 seconds) and the ASP review feed (10 seconds) so a stalled service cannot block syncs (including a ragequit's), and stop showing cached review statuses to accounts without `aspReviewServiceFactory`
- a2177fd: feat: let accounts share one copy of the chain state through `chainStorage`, and export the storage key builders. The plugin no longer saves anything per account: history timestamps are shared with the chain state, and exact metadata saved by older versions is no longer used. States saved by earlier versions are dropped and synced again.
- d884f3e: `prepareUnshield` accepts `label` in relayer and paymaster mode to spend one specific note. If that note is missing, belongs to another asset, is not approved, or does not cover the gross amount (fees included with `exact`), preparation throws the new exported `PPv1NoteUnavailableError` (`label`, `reason`, `balance`, `required`) instead of picking another note. `label` cannot be combined with `batch: true`; with `obfuscateAmounts`, the ceiling and change apply to the chosen note alone.

  Automatic single-note selection now skips unapproved and empty notes. Before, it could pick an unapproved note smaller than an approved one and fail later while proving.

- Updated dependencies [27cf0a7]
  - @kohaku-eth/poseidon-lean-imt@0.0.1-alpha.1

## 0.1.0-alpha.38

### Patch Changes

- dc9cc90: feat: external delegation mode

## 0.1.0-alpha.37

### Patch Changes

- 7597523: fix: final audit fixes

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
