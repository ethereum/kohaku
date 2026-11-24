## 0.1.0-alpha.40

### Patch Changes

- e633dda: Preserve leading zeros in pool addresses when reading their verifiers for paymaster gas estimation. Withdrawals involving a leading-zero pool, including Sepolia's 0.01 ETH pool, no longer fail with an RPC `Invalid params` error. This applies to both single-note and batched withdrawals.

## 0.1.0-alpha.39

### Patch Changes

- b6a67fa: Reject an explicit zero or negative unshield amount instead of selecting every available note. Omitting the amount still selects all notes.

## 0.1.0-alpha.38

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
- bb2d541: When the bundler refuses a paymaster withdrawal, `broadcast()` checks whether the sender's EntryPoint nonce or EIP-7702 authorization nonce moved past the one the withdrawal was signed for (a lower reading, from a lagging provider, keeps the bundler's error): the sender sent a transaction, or another withdrawal from the same sender landed first. If so, its `not-accepted` `PaymasterBroadcastError` carries `staleNonce` (`{ kind: 'entry-point' | 'authorization', signed, current }`, type `StaleSenderNonce`) so an app can tell this case apart without parsing a generic bundler error. Another operation from the sender may have spent the same notes, so callers should confirm earlier outcomes and sync before preparing another withdrawal.
- 8b1f9bc: Paymaster withdrawal preparation no longer sends an executable UserOperation to the bundler. Before, `eth_estimateUserOperationGas` received the signed operation with real proofs, so a bundler could submit it before `broadcast()`, even for a dry run or a declined confirmation.

  Gas estimation now uses a simulation payload: a dummy account signature, a dummy EIP-7702 authorization, and dummy Groth16 proofs with random nullifier (and, for Privacy Pools, commitment) hashes. This applies to the sponsoring note and to batched `withdraw` calls. State overrides make each pool's verifier run its real code at a shadow address and return `true`, so the estimate includes real verification gas plus about 3k. After the limits converge, the SDK proves each note and signs once, locally.

  - The configured bundler must support `eth_estimateUserOperationGas` state overrides (Pimlico and Alto do). Preparation reads each pool's verifier address and code from the host provider.
  - External and smart-account signers get one signature prompt, after estimation. Before, each refinement round needed a signature. An invalid or rejected signature now stops preparation after estimation instead of before.

- 6555ce9: Paymaster withdrawals call the `tailCalls` callback once per preparation and reuse its calls for every estimate and the signed operation. Before, the callback ran again on every rebuild, so a callback that answered differently could produce signed calls that were never estimated and run out of gas after the payout reached the sender.

  The callback must resolve to an array of `{ to, value, data }` calls with a valid address, a non-negative bigint `value` and hex `data`. Anything else stops preparation before estimation or proving. The SDK copies the calls, so later changes to the returned objects have no effect.

- 86cba90: A lost paymaster send response can now be recovered by hash for smart-account senders. Tornado Cash payloads carry `userOpHash`, and `serializedUserOperationHash` accepts a chain id and includes SimpleAccount deployment fields, which are part of the signed hash.
- 8643892: Verify each pool's events before storing them: the tree they complete must match the Pool's `getLastRoot()` read at the synced block, instead of the pool cursor advancing on whatever the sync source returned. A stream from the external sync provider or the chain that is missing leaves (including its newest ones, whose root is still in the recent history), has a hole in its leaf indices, or carries a forged leaf now fails the sync and leaves that pool's events and cursor untouched, so the next sync retries it. A pool with no synced leaves is checked through `nextIndex()`. Pools that pass keep their progress. `syncEventsThunk` takes a `dataService`, and `IDataService` gains `getPoolNextIndex` and an optional block number on `getPoolStateRoot`.
- a6b620f: Verify a pool's initial scan block before persisting it: the external provider's first covered block is only used when the pool has no code in the block before it, the on-chain deployment search rejects malformed `eth_getCode` responses and undeployed addresses, and an empty log range no longer advances the sync cursor. Event syncs now backfill from the chain any blocks before the provider's first covered block, and report the chain tail's actual cursor instead of the initial head.
- 98d32a0: Reject oversized worker-to-host call envelopes before traversing or copying their argument arrays. Current host calls accept at most two top-level arguments. Bound path depth and metadata strings, and avoid coercing malformed path elements when reporting refusals. These checks apply after message delivery and do not prevent structured-clone costs or message flooding.
- bac87f3: `broadcast()` no longer hides failed withdrawals or reorders results. Before, a failed relayer withdrawal was only logged with `console.warn` and left out of the resolved results, and results were grouped by mode, so they no longer matched the operation's withdrawals by position.

  `broadcast()` now resolves with one response per withdrawal, in the operation's order. If any of several withdrawals fails, it rejects with the new `TornadoBroadcastError`, after trying the rest; its `results` holds every withdrawal's outcome in order, including the responses of those that were sent. An operation with a single withdrawal, including every paymaster operation, still throws that withdrawal's own error, such as `PaymasterBroadcastError`; `broadcast()` only ever rejects with an `Error`.

  This changes behaviour for relayer unshields that spend several notes: a partial failure now rejects instead of resolving with fewer results.

- 4f991b4: A paymaster unshield's `delegation.path` is now allowed on the scoped keystore and the worker's secret-manager bridge only while that unshield is being prepared. Before, every path ever named stayed allowed for the life of the protocol instance, including invalid ones and those of failed preparations, and each key derivation scanned all of them.
- f44e524: Try other available note combinations when largest-first withdrawal selection cannot reach the requested gross total exactly. This fixes requests such as 0.12 ETH from four 0.03 ETH notes when a 0.1 ETH note would otherwise block selection. Successful existing selections and fee handling are unchanged.
- 269bcf2: The opt-in execution-gas retry (`executionGasRetry`) now increases gas only for a bundler JSON-RPC rejection with the ERC-7769 execution-phase code (`-32521`) whose message says the execution ran out of gas. Before, matching words in any error text, including other error codes, transport errors or plain errors, could trigger a more expensive retry.
- f14047c: Validate relayer destinations before status and withdrawal requests. Require DNS hostnames and HTTPS root URLs, reject authority and path injection, and disable redirects. Validation also covers destinations restored from snapshots or supplied in prepared operations.
- 6d6eccd: A relayer whose `/status` reports a `rewardAccount` that is not a nonzero address is now rejected before quotes are ranked. Before, it could win on price and make preparation fail when proving, without trying the other relayers.
- 955c9a5: Limit RPC log pages to 10,000 logs and 4 Mi characters across log string fields before accumulating or ABI-decoding them. Oversized pages retry with a smaller block range; a single block exceeding the limits fails the scan without truncating history. Pages cover consecutive blocks without overlapping their boundaries.

  The host provider still owns raw HTTP response limits, since it returns already-parsed logs to the SDK.

- ac396bc: Validate saved Tornado Cash state and initial snapshots before use, including tuple shapes, numeric fields, imported secrets and deposit indices. Invalid state produces a recovery error without deleting or overwriting the original. Keep older optional snapshot fields compatible and serialize negative bigints in a readable decimal form.

  Restart pools with impossible saved cursors from a verified deployment boundary. Valid stored cursors remain trusted coverage claims; hosts can opt into a clean resync for suspected missing history while preserving imported notes.

- 231355b: Use the head captured at the start of an event scan as the explicit RPC query bound. Empty relayer registry scans can no longer advance their cursor using a later, inconsistent head read. The shared pool scan path uses the same bound; a query failure leaves the cursor available for retry.
- ed940bd: Fail the sync when a pool's configuration or events cannot be fetched instead of
  dropping that pool silently. Previously a rejected `getPoolEvents` (for example an RPC
  that refuses wide `eth_getLogs` ranges) or pool configuration lookup was ignored, so
  `balance` and `prepareUnshield` reported that pool's notes as zero with no error. A pool
  that still fails verification after the chain replay is reported the same way. Pools
  that did sync keep their progress, which is now saved before the sync fails, and the
  failed ones keep their previous cursor, so the next sync retries exactly the range that
  failed. An RPC node that lags behind a pool's saved head does not fail the sync: the
  pool keeps the events it already had. The error is a `TornadoPoolSyncError` whose
  message lists the failed pools and the first line of each distinct reason (request
  URLs, which may carry RPC API keys, are left out).
- ac396bc: Verify each pool's synced deposits before storing them. A sync rebuilds the pool's Merkle tree and requires gapless leaf indices, the pool's on-chain leaf count and its exact root at the scanned head. On a mismatch nothing is stored and the cursor does not move. Events from the external sync provider are retried from the chain alone, and a chain scan that still fails replays the pool from deployment. Each pool saves its tree frontier at the finalized block, so a sync hashes only the deposits it scanned again, and a withdrawal checks the pool's last verified root instead of rebuilding the tree. The separate `verify` sync option is removed, since every sync now verifies.

  Track a finalized cursor per pool and rescan everything after it on each sync, dropping deposits and withdrawals a reorg removed. Pools saved before this are rewound 7,200 blocks once. The RPC must support the `finalized` block tag.

## 0.1.0-alpha.37

### Minor Changes

- 7241ff4: Support compatible caller-selected EIP-7702 implementations and external typed-data-only owners of SimpleAccount v0.8 accounts, including factory deployment. Preserve sponsored withdrawal proof formats and paymasters, pin signing scopes, and avoid redundant forwarding when withdrawing a batch into its execution account.
- 7241ff4: Always pay single-note withdrawal proceeds and gas refunds directly to the requested recipient when no tail calls are supplied, for every supported account family, keeping execution calldata empty and execution gas zero. Explicit tail calls retain sender-bound sponsorship and execution for both single-note and batch withdrawals, with compatible EIP-7702 implementations or smart accounts.

  Add explicit `executionGasRetry` opt-in for bounded recovery from recognized execution-gas shortages with a required positive `maxGasLimits.callGasLimit` ceiling. A ceiling alone no longer enables retries. Each retry rebuilds the fee, proof and signature and re-estimates the final signed operation.

- 2347aad: fix!: report paymaster withdrawal outcomes correctly. Paymaster `broadcast()` used to drop failed withdrawals with only a `console.warn` and never checked the receipt's `success`, so a reverted user operation looked successful. It now resolves as soon as the bundler accepts the user operation, and each result has a `wait()` that resolves with the `txHash` once it is mined successfully. Both throw a `PaymasterBroadcastError` (`not-accepted`, `reverted` or `unconfirmed`), whose message never includes the signed user operation. If the send request fails but the bundler already has the user operation, `broadcast()` resolves as usual. An `Already known` answer to the send counts as accepted. Otherwise it reports `not-accepted`, with the hash, only if the bundler answered the send with an error, and `unconfirmed` with the hash if the send got no answer, because some bundlers only know mined user operations.

  Callers that relied on `broadcast()` waiting for the receipt must now call `wait()`. Custom `paymasterClientFactory` clients must return `wait()` too.

### Patch Changes

- 7241ff4: Preserve reuse of explicitly selected external and wallet-path EOAs without requiring `allowUsed: true`, including existing delegation to the selected implementation. Freshness checks remain the default for note-derived/random senders and smart accounts; explicit `allowUsed: false` also enforces them for wallet EOAs.

  Budget factory deployment gas only when the prepared account still needs deployment. For Tornado execution-gas retries, retain a successful probe's gas budget instead of trimming back to an estimate that can fail again.

## 0.1.0-alpha.36

### Patch Changes

- f9db950: fix: single-note withdrawal delegation

## 0.1.0-alpha.35

### Patch Changes

- dc9cc90: feat: external delegation mode

## 0.1.0-alpha.34

### Patch Changes

- 7597523: fix: final audit fixes

## 0.1.0-alpha.33

### Patch Changes

- 51669b3: Skip the uncatalogued-pool warning when an explicit instance catalog deliberately restricts pool selection. Continue filtering excluded pools, and retain warnings for unexpected gaps in the default chain catalog.

## 0.1.0-alpha.32

### Patch Changes

- a98a88f: Check paymaster bundler gas prices against the host RPC fee market, bound validation overhead and payload-sized pre-verification gas, and send bundler requests through the host network. Tail-call execution gas can grow with the bundler estimate; optional `maxGasLimits` sets explicit absolute ceilings. There is no percentage-of-withdrawal fee cap. The sponsoring note must still cover the fee. Tornado prepared paymaster payloads include the proof-bound fee and total withdrawn value, with optional fields for compatibility with older saved operations.
- 7a7c9a1: Improve paymaster estimation availability without restoring silent catch-all fallback.
  Retry recognized temporary transport failures once, using the exact signed payload
  and honoring short Retry-After headers. Broadcasts are never retried by this logic.

  Add gasEstimationPolicy (default best-effort, with required available for strict
  callers). On mainnet/Sepolia, standard withdrawals with recoverable senders and no
  user tail calls may fall back after recognized transport failures or the bundler's
  opaque simulation-parser internal error. Real validation failures, invalid estimates,
  random senders, unknown chains and user tail calls never use this fallback.

  Rebuild fallback fees, proofs, forwarding calldata and signatures using 350000 gas
  of pre-verification overhead plus a variable-payload allowance, preserving higher
  previous estimates. Reject fees that consume the sponsoring note. Prepared payloads
  include gasEstimation metadata so consumers can display or reject fallback results.
  Fallback budgets are conservative heuristics and may still be rejected or execute
  unsuccessfully; consumers must display the actual committed fee before broadcasting.

- eb83865: Require successful bundler gas estimation when preparing paymaster withdrawals.
  Previously an estimation failure silently returned static limits, which could
  produce signed operations rejected for insufficient preVerificationGas.

  Single-note and consolidated withdrawals now rebuild the sponsoring fee, proof,
  forwarding calldata and signature when gas estimates increase, then estimate the
  exact rebuilt payload again. Refinement is bounded to three attempts.

  Single-note withdrawals now also pay the recoverable sender and forward to the
  requested recipient during execution.
  This avoids `CallGasLimitNonZero` when bundlers inject a nonzero gas-search
  ceiling during estimation. Explicit delegation settings apply to single notes
  too; unused-gas refunds can remain on the sender after forwarding.

  Bundler HTTP requests use a 180-second timeout and no transport retries. Preparation now rejects on estimation failure,
  invalid estimates or non-convergence instead of returning an unchecked fallback.

- Updated dependencies [d8bf680]
- Updated dependencies [d8bf680]
  - @kohaku-eth/provider@0.1.0-alpha.14
  - @kohaku-eth/plugins@0.0.1-alpha.20

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
