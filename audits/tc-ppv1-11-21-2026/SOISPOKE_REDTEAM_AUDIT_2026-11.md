---
title: Kohaku plugins and kohaku-cli: red team/audit
date: 2026-11-21
---

# Kohaku plugins and kohaku-cli: red team/audit## TL;DR

The cryptography is right: Tornado Cash's pure-JS Pedersen, MiMC tree and Groth16 prover match circomlib and verify against the tornado-core verifier, and the Privacy Pools context hash, commitments and state-root checks match the 0xbow contracts. What breaks is trust in what the plugins download and in the third parties they talk to. Two findings are critical. The Tornado plugin downloads tornado.json from an unpinned branch head and its prover runs the JavaScript inside that file with new Function on every proof, so whoever controls the file, or the kohaku-cli mirror and cache, gets code execution in the wallet process, which can read the note's secrets and the filesystem (demonstrated); reaching the mnemonic's keys follows from file write access and the unrestricted keystore but was not demonstrated. In Privacy Pools relayer mode, the SDK's default, the relayer's own withdrawalData goes into the proof unchecked, so a relayer can set itself as recipient and take the whole withdrawal; kohaku-cli avoids this one because it only uses paymaster mode. Eight high findings follow: fees that relayers and bundlers set with no cap (Tornado relayer mode, and both plugins' paymaster mode), Tornado deposit targets taken from the RPC that the CLI never checks against its own catalog, three privacy leaks (the CLI's stealth balance batch, Privacy Pools history(), Railgun sender reuse in the CLI), and plugin keystores that hand out any path. None needs a redesign: the fixes are hash pinning, decoding and checking before proving, client-side fee caps, static pool lists and separate transports. The stack is not production-ready until the two criticals and the high findings are fixed, and until tornado-cash has a working unit suite in CI (today 10 of 26 unit tests fail, all on root verification, and CI never runs unit tests).

## Scope and method

* **Targets:**
    
    * @kohaku-eth/privacy-pools (7.9k lines)
    * @kohaku-eth/tornado-cash and mimc-tree (6.3k)
    * @kohaku-eth/plugins and provider (1.4k)
    * the monorepo's CI and release pipeline
    * kohaku-cli 0.0.7 (24k lines)
    * open PRs #317 and #320, read as upcoming changes
* **Out of scope:** Railgun internals (the package is in maintenance) and the 0xbow and tornado-core contracts, which were read only to confirm bindings. The \[\[drafts/hegota-kohaku-cli/reviews/2026-10-06-full-audit-claude/2026-10-06-synthesis-claude|10-06 audit\]\] covered the Rust Hegotá CLI and only cross-checked this TypeScript CLI. This pass is the first review of the plugins.
* **Reviewers:**
    
    * The first wave was seven parallel reviewers: Privacy Pools crypto, Privacy Pools flows, Tornado crypto, Tornado flows, plugins/provider/supply chain, CLI secrets and network, and CLI fund flows.
    * The second wave was three targeted follow-ups: the blast radius of the circuit injection, the bundler fee economics against the deployed contracts, and shield-side validation in the CLI.
    * The coordinator checked every critical and high finding against the code before including it, reran the circuit-injection PoC independently, and read the paymaster's EntryPoint deposit on-chain. Medium, low and info findings are as reported by the reviewers (most with file and line references, some with harnesses) and were not each re-checked by the coordinator; treat them as likely rather than confirmed. Mock-based harnesses are in evidence/ (see its README).
    * Every exploit was shown against mocks of the RPC, relayer, bundler or artifact host, never against the real services. Severity assumes the named party is malicious or compromised.
* **What was not done:** no transactions were sent and nothing was broadcast. The only real network calls were read-only npm view, GitHub raw, Sourcify, a public RPC eth\_call). Every CLI run used a throwaway HOME.
* **Baseline test results:**
    
    * kohaku-cli npm test: 340/340 pass.
    * privacy-pools unit tests: 84/84 after building the workspace.
    * tornado-cash unit tests: 10 of 26 fail (stale tests).
    * Both plugins' default test scripts run only Sepolia fork e2e tests, which need secrets.

## Critical### C1. Tornado: a tampered circuit file executes code inside the wallet

Found by Tornado crypto (TCC-1). The second wave traced the blast radius; the coordinator reran the PoC.

**Where the file comes from.**

* The plugin's default loader fetches tornado.json and tornadoProvingKey.bin from [raw.githubusercontent.com/tornadocash/tornado-cli/refs/heads/master/…](http://raw.githubusercontent.com/tornadocash/tornado-cli/refs/heads/master/%E2%80%A6) tornado-cash/src/utils/default-artifacts-loader.ts:3-7). That is a mutable branch in an organisation the project doesn't control.
* Nothing checks a hash, or even res.ok circuit-loader.ts).

**Why that means code execution.**

* The legacy circom JSON format carries each template as JavaScript source.
* micro-zk-proofs@0.3.1/witness.js:187,193 compiles it with new Function, inside the state-manager worker, on every prove() tornado-prover.ts:180).
* Node's worker\_threads share the process, so this is arbitrary code execution as the user. The injected code can:
    
    * read the note's nullifier and secret, then front-run the withdrawal with its own proof;
    * read and write the filesystem;
    * backdoor the code that holds the keystore.
* The keystore proxied into that worker accepts any path (see H8). In kohaku-cli it closes over the decrypted mnemonic src/host/makeHost.ts:59, src/host/keystore.ts:30-41). Injected code cannot name the keystore proxy directly, so stealing main EOA keys was not demonstrated; it would take a second step, such as using file write access to backdoor the code that holds the keystore for the next run.

**kohaku-cli has the same exposure.**

* Artifacts come from the third-party mirror [https://artifacts.0000000000.org](https://artifacts.0000000000.org) (or GitHub master). They are cached forever in ~/.kohaku-cli/proving-artifacts/ with mode 0644 and no hash check src/utils/proving-artifacts.ts:245-263, 315-353).
* One poisoned cache entry affects every wallet under that HOME.

**Evidence (RUN, evidence/tc-crypto/prove-poc.mts).**

* An injected payload in the real Withdraw template wrote out the exact nullifier and secret plus $HOME, through the plugin's own makeLazyProverFactory and createTornadoProver.
* The proof still verified against tornado-core's verifier, so the attack is silent. Reproduced by the coordinator: proving took 9.7 s, the proof verified, and the exfiltrated values matched.
* Current upstream hashes are tornado.json 3ddd61db…6f98 and tornadoProvingKey.bin 8e2d2f22…a3af. The proving key is consistent with the on-chain verification key.
* Privacy Pools does not share this: its witness generator is circom wasm, which is sandboxed. Its artifacts are fetched from a commit-pinned GitHub URL without a hash check, so the risk there is integrity only.

**Fix:**

1. Bundle both files with SHA-256 pins, and verify after every fetch and every cache read.
2. Stop evaluating circuit JSON. Ship a wasm or precompiled witness generator for the fixed Tornado circuit.
3. Restrict the keystore (H8).
4. Create the CLI cache directory 0700 and its files 0600, gated by the pin.

### C2. Privacy Pools relayer mode: the relayer chooses the recipient

Found independently by Privacy Pools crypto (PPC-1) and Privacy Pools flows (PPF-1), both RUN; the coordinator checked the code.

**What the code does.**

* validateWithdrawalData is a TODO that only logs a warning privacy-pools/src/state/thunks/quoteThunk.ts:26-48).
* The relayer's feeCommitment.withdrawalData becomes withdrawal.data and is hashed into the proof context state-manager.ts:353-357).
* The exact-output path copies quoted.recipient and quoted.feeRecipient state-manager.ts:436-440).
* Quotes are ranked by the relayer's self-reported feeBPS, not by the fee embedded in the data.

**Attack.**

* The SDK has no built-in relayer; the attacker is any relayer the integrator configures through broadcasterUrl, or whoever compromises its server or DNS. It advertises feeBPS: "0" and so always wins.
* It returns relay data that pays itself.
* The user proves it, and the contract's context binding then guarantees the payout goes to the attacker.

**Exposure.**

* prepareUnshield without mode is relayer mode, so any wallet integrating the SDK the default way is exposed.
* kohaku-cli always passes mode: 'paymaster', so it is not, even though its pinned alpha.24 has the same stub dist/index.js:2574).

**Fix:**

* Decode the relay data, and require recipient == to and relayFeeBps <= min(quote, user cap, maxRelayFeeBPS).
* Rank quotes by the decoded fee.
* In exact mode, use the caller's to.

## High### H1. Tornado relayer mode: the relayer sets the token price, so the fee can take almost the whole note

Found by Tornado flows (TCF-1, RUN); the coordinator checked the code.

* **Fee formula:** for ERC-20 pools the fee is networkFee × 10\^decimals / tokenPrice + serviceFee tornado-cash/src/state/thunks/withdrawThunk.ts:86-99).
* **Where tokenPrice comes from:** the relayer's /status ethPrices, unbounded. Only tornadoServiceFee is range-checked. The contract allows up to fee <= denomination.
* **Evidence:** with mock relayer and RPC, a DAI 100 note proved with a fee of 95.01 DAI to the relayer's rewardAccount.
* **ETH pools:** RPC eth\_gasPrice × 550k is likewise uncapped.
* **Exposure:** the CLI is not exposed (paymaster only).
* **Fix:** cap the total fee against an independent price (the paymaster's on-chain TWAP quoteWeiInToken would do) and a percentage of the denomination, and show the fee before proving.

### H3. Tornado deposits go wherever the RPC says; the CLI never checks its own catalog

Found by Tornado flows (TCF-5) and the second wave (RUN).

**In the plugin.**

* It reads instance addresses and denominations from the registry by eth\_call and caches every pool it sees forever syncPoolsThunk.ts:24-25,70, data.service.ts:200-233).
* getDepositPayloadThunk.ts:82-87 splits the amount across any matching pool. A fake pool with an odd denomination is therefore chosen first.

**In kohaku-cli.**

* It keeps a static catalog src/utils/tornado-pools.ts) but uses it only to check that the amount is a multiple of the smallest denomination.
* partitionShieldTxs and resolveShieldApprovalCalls take the plugin's to and approve spender as given src/lib/shield-flow.ts:300-385).
* The prompt never shows the target.
* The harness fed it a deposit to 0x…dEaD: accepted, and for DAI it built approve(0x…dEaD, 100 DAI).

**Who can do this:** a malicious or MITM'd RPC (the CLI accepts plain http:// RPCs). The poisoned pool survives switching to an honest RPC.

**Fix:**

* Pin instances and denominations per chain in the plugin.
* In the CLI, check every deposit call against the catalog: target, value, deposit(bytes32) selector, approve token and spender.
* Show the targets in the prompt.

### H4. kohaku-cli sends every stealth address and every HD address to the clearnet RPC in one batch

Found by CLI secrets and network (CLS-1); the coordinator checked the code.

* balances merges HD accounts and stealth accounts into one list and fires every getBalance and balanceOf concurrently src/lib/balances-snapshot.ts:618-676). The comment says this is so viem packs them into one POST src/utils/rpc.ts:152, batchSize 100).
* The RPC operator therefore receives the user's IP, the main addresses and every stealth address in one request, which undoes stealth unlinkability for the provider.
* Unbatching alone does not fix it, because the same IP and timing still link them.
* The stealth scan itself is sound: announcements are fetched in bulk and view tags matched locally.
* **Fix:** read stealth balances over a separate transport (Tor with a fresh circuit, or a second RPC), one at a time with jitter.

### H5. Privacy Pools history() gives the RPC the exact blocks of the user's deposits, withdrawals and ragequits

Found by Privacy Pools flows (PPF-3); the coordinator checked the code.

* syncHistoryMetadataThunk.ts:38-67 issues single-block eth\_getLogs(pool, B, B) and eth\_getBlockByNumber(B) calls for only the user's own events, five at a time (added by PR #316).
* Deposit blocks name the depositor, so the RPC learns the deposit-to-withdrawal link that the pool exists to hide.
* **Exposure:** the CLI does not call history(). Any wallet that shows history does.
* **Fix:** keep the transaction hash and log index during the bulk sync, which already fetches every log data.service.ts:33-35 currently zeroes the hash), or fetch padded ranges or decoys.

### H6. kohaku-cli signs Railgun unshields to an external address with the next "fresh" address, without reserving it

Found by CLI fund flows (CLF-2); the coordinator checked the code.

* For a Railgun ERC-20 unshield to a --to the wallet has no key for, the EIP-7702 UserOp is signed with peekNextAccounts(1) src/commands/unshield.ts:146-159, 537), and that index is never persisted.
* Every external unshield therefore shares the same on-chain sender.
* The next --next hands that same address out as fresh, tying the user's new public address to past withdrawals.
* Railgun is outside the plugin scope, but this is CLI code.
* **Fix:** sign with a throwaway key, or reserve and persist a dedicated index first. Never sign with a key that will later be handed out as a fresh address.

### H7. The Privacy Pools IPFS ASP source is trusted for leaves; only the root it supplies itself is checked

Found independently by Privacy Pools crypto (PPC-2) and Privacy Pools flows (PPF-2), both RUN. Rated high because it is the default path and its main effect is a privacy loss.

* ipfsAsp.service.ts:37-39 returns the gateway's levels as-is. syncAspThunk.ts:30-41 compares only the gateway's last level to the RootUpdated root.
* verifyRootsThunk checks that same root on-chain, never one recomputed from the leaves.
* IPFSAspService is the default plugin/base.ts:108, gateway [ipfs.filebase.io](http://ipfs.filebase.io)).

**What a malicious gateway can do:**

* Hide an approval: the note shows as pending and becomes a ragequit candidate. Ragequit is a public, linked exit, so the wallet nudges the user to deanonymise themselves.
* Fake an approval: the withdrawal is proved and then reverts.

**Fix:** recompute the LeanIMT root from the leaves, as 0xbowAsp.service.ts:85 already does. Assert aspMerkleProof.root == latestRoot before proving.

### H8. Plugin keystores hand out any path, including the main wallet key

Found by plugins/provider (PLG-1, RUN) and the second wave.

* Host.keystore.deriveAt(path) accepts any path, including m/44'/60'/0'/0/0 and the master m plugins/src/host/mnemonic-keystore.ts:83-100).
* network.fetch is unrestricted, and storage is one flat namespace.
* The same holds for the CLI's keystore src/host/keystore.ts:30-41).
* The plugins README says plugins may be "loaded dynamically at runtime by wallets". A third-party plugin, or any code execution inside one (C1), can then derive and send out the user's EOA keys.
* Rated high because it removes the only defence-in-depth behind C1. It would be medium if plugins are only ever bundled first-party.
* **Fix:** per-plugin keystore wrappers with a path-prefix allowlist (Privacy Pools m/28784'/…, Tornado m/29795'/…, Railgun …/1984'/…). Refuse coin type 60 and depth 0. Namespace storage per plugin and allowlist network hosts.

## Medium

**Still present from the 10-06 cross-check (kohaku-cli):**

* **Reverted transactions and UserOps reported as success (CLF-4).**
    
    * viem-tx.ts:99-100 discards the receipt.
    * eip7702-batch-userop.ts:303-313 ignores receipt.success.
    * tornado-paymaster-broadcaster.ts:167-171 ignores the receipt.
    
    A failed Privacy Pools or Tornado tail call reports "broadcast complete" while funds sit on the executor.
* **Dry runs and estimates made before the prompt sign a real EIP-7702 authorization and send it to Pimlico (CLF-3, RUN).**
    
    * Affects transact-raw, shield batch and transfer --stealth.
    * Answering No at the prompt does not help: the authorization was already sent.
* *unshield --next saves the index only after the relay call returns (CLF-5).*\* The broadcaster treats a send timeout as probably landed and then waits 180 s. Over Tor, a late landing means the next --next reuses the address.
* **Non-atomic store writes and default file modes (CLS-6, RUN).**
    
    * .encrypted-seed.json is 0644 in a 0755 directory, and aes-storage.ts:139 rewrites in place.
    * Imported Tornado notes in tc-storage.json cannot be derived from the seed, so a torn write loses them.
* **Secrets on argv (CLS-7).**
    
    * \--password and --mnemonic are still accepted.
    * import-tornado-note takes notes only as positional arguments.
    * export-tornado-note prints a ready-to-paste importCommand containing the note.
* **Unpinned downloads and same-server manifests (CLS-4, CLS-5).** See C1 and the next group.

**Untrusted data sources:**

* **Sync-cache snapshot server (CLS-4, RUN).**
    
    * The manifest is unsigned.
    * installPublicSyncCacheArchive installs every cache-key-shaped file in the tar, including ones the manifest did not list, and overwrites good entries. Entries are then served forever for every wallet in the data directory.
    * Impact: wrong balances and DoS. On-chain root checks stop forged leaves from becoming theft.
* **Saga event contents are not covered by the root check (PPF-6).**
    
    * Only commitments feed the Privacy Pools root. The other Deposited, Withdrawn and Ragequit fields and the entrypoint events are trusted.
    * The CLI's saga client has no manifest publicKey.
    * A malicious CDN can fake a ragequit (balance 0), change nullifiers, or misattribute pools.
* **Privacy Pools sync reads two different heads (PPF-5, RUN).** syncThunk.ts:39-63 fetches entrypoint logs to H0 and pool logs to H1, then saves the last event block as the sync point. A pool event in (H0, H1\] permanently hides the user's own EntrypointDeposited. In the run, after three more syncs the wallet still had balance 0.
* **Tornado sync has no confirmation depth, gap check, address filter or rollback (TCF-4).**
    
    * A reorged-out deposit, or one the provider drops or injects, leaves a root that never matches.
    * lastSyncedBlock has already advanced, so every withdrawal from that pool fails until the state is wiped.
* **Names resolve through the user's RPC with no cross-check (CLS-2).** ENS, GNS, WNS and the stealth meta-address registry. With --stealth the prompt shows only a random-looking address, so a swapped meta-address is invisible to the user.
* **CCIP-Read is on during name resolution (CLS-3, RUN).** A fake RPC's OffchainLookup made the CLI send more than 8,700 GETs to a URL of its choosing in 25 s, before Tor starts.
* **Anon provider bootstrap (PLG-2).** The worker hash and URL are read with an unverified eth\_call from the bootstrap RPC, so the "hash-pinned" worker is only as trusted as that RPC.

**Fund flows:**

* **Tornado multi-note paymaster batches are not atomic (TCF-3).**
    
    * Note 0 is withdrawn during validation and the rest during execution.
    * A revert, or a front-run of the embedded proofs, strands funds on the sender.
    * In delegation.mode === 'random' the sender key is generated and thrown away, so those funds and every postOp refund are lost. The CLI forces a deterministic wallet-held key.
* **Token decimals and symbol come from the RPC when --token is an address (CLF-1, RUN).**
    
    * A lying RPC can make "1 USDC" sign 10\^12 base units.
    * The symbol is printed raw, so terminal escape codes can rewrite the prompt.
    * Requires a malicious RPC and a balance large enough to cover the inflated amount.
* **The unshield dry run prints a complete, submittable signed UserOp (CLF-7).** Anyone who sees the output controls the timing.
* **Open PR #320 (PPF-7, RUN).** Its incremental tree cache reuses the ASP tree when the last leaf matches. The ASP set is not append-only, so a long-running process proves against a stale tree after a revocation.

**Key handling:**

* **Signature-derived note secrets (PR #319).**
    
    * Determinism depends on viem's process-wide setSignEntropy staying off, and on signers using RFC 6979. Otherwise the deposit precommitment cannot be re-derived, and ragequit needs it (PPC-3, latent, RUN).
    * The EIP-712 domain is public, so an external signer that is the user's dapp-facing account can be phished for a note's secrets with one signature (PPC-4, PLG-11). The software default, m/28784'/1'/…, is not exposed.
    * canonicalRS assumes r‖s‖v while the comment says framing does not matter. Ledger's v‖r‖s fails in 1970 of 2000 cases and misparses in 30 (PPC-5, RUN).

**Supply chain and CI:**

* **The release job (PLG-3)** holds id-token: write and contents: write while running third-party actions on mutable tags dtolnay/rust-toolchain@master and others), a curl with no checksum, and the full build. It can be dispatched from any branch with no environment guard.
* *@anon-rpc/browser-harness (PLG-4)*\* is a caret range on a single-maintainer package with no provenance. Consumers resolve 0.3.3 today, not the 0.3.0 in the lockfile, and this package enforces the worker sandbox.
* *@kohaku-eth/tornado-cash → @privacy-paymasters/sdk@0.0.5 (PLG-5)*\* pulls in the @pimlico/alto bundler server and prool as runtime dependencies. That brings fastify, tar 7.2.0 with critical advisories, and install scripts.
* **npm dist-tags (PLG-6).** latest for privacy-pools and tornado-cash points at stale 0.0.1 placeholders, one of them hand-published with no provenance.
* **CI never runs unit tests (coordinator).**
    
    * verify.yml runs only the Sepolia e2e project, and only when secrets are available, so external PRs get no tests at all.
    * pnpm audit is continue-on-error.
    * As a result, 10 of 26 tornado-cash unit tests fail unnoticed: root verification mocks lack isPoolRootValid, and verifyRootsThunk tests call removed helpers. The suite gives the security-critical root check no coverage.

## Low and info

* **Tornado:**
    
    * Deposit discovery stops at the first missing index, hiding later deposits until the gap is filled (TCF-7, TCC-2).
    * An amount of 0n withdraws every note (TCF-6, RUN).
    * Relayer failures are only console.warn (TCF-8).
    * Note-parse errors include the full secret note (TCC-3, RUN).
    * The note header is ignored, and the first pool containing the commitment wins, so a copied commitment in a cheap pool hides the real deposit (TCC-4).
    * Imported legacy secrets are written to host storage as plaintext JSON (TCC-5, TCF-9).
    * Groth16 r and s carry a negligible modular bias (TCC-6).
* **Privacy Pools:**
    
    * Note selection can pick an unapproved note (PPC-7, PPF-8).
    * The chain ID from the RPC selects the store, the derivation domain and the config, with no pin (PPF-9).
    * No response.ok check on relayer and 0xbow ASP responses, and no size limit on IPFS responses (PPF-10).
    * Circuit files (23 MB) are re-downloaded per proof with global fetch, bypassing host.network, so the download timing correlates with withdrawals (PPC-6).
    * The default secret scheme changed (HD → signature), so upgrading the CLI without injecting the old SecretManager hides existing notes (PPC-8, CLF-12).
* **Provider:**
    
    * The Helios bypassLogs path is unverified and uses global fetch (PLG-7).
    * The Colibri wrapper lets user config switch off zk\_proof (PLG-7).
    * The viem adapter drops topics and throws on pending receipts (PLG-8, RUN).
    * waitForTransaction hides status, and PR #317's wait loop discards a receipt that arrives exactly at the deadline (PLG-9).
    * MnemonicKeystore accepts junk path segments, depth 0, and mnemonics with bad checksums (PLG-10, RUN).
* **CLI:**
    
    * Single Tor circuit per session; fetches outside a session go clearnet (CLS-8).
    * No size limits on snapshot and saga downloads (CLS-9).
    * Password whitespace handled differently at create and unlock (CLS-10).
    * The traffic log is plaintext 0644; the local Pimlico proxy is unauthenticated; RPC errors print the full URL (CLS-11).
    * Delegation replacement and the approve spender are not shown (CLF-8).
    * Privacy Pools 7702 authorizations hardcode nonce 0 (CLF-9).
    * \--base-fee-gwei and --priority-fee-gwei are ignored (CLF-10).
    * Amount parsing rounds excess decimals and accepts hex (CLF-11).
    * The Privacy Pools ERC-20 approve does not handle USDT's approve-from-non-zero rule.
    * There is no ragequit command, so a deposit the ASP rejects cannot be recovered from the CLI.
* **Repository:** encrypted SOPS secrets remain in public history until 8ac0c52; rotate those keys. Tornado test keys are labelled "anvil default" but are not Anvil's (PLG-12).

## What was verified sound

* **Tornado crypto (RUN):**
    
    * Commitment and nullifierHash match circomlib@0.0.20 Pedersen on 32 notes.
    * The MiMC tree (20 levels, zero = keccak("tornado") mod r) matches an independent MiMCSponge for 0 to 33 leaves, and the multi-threaded tree equals the single-threaded one at 5,000 leaves.
    * Proofs verify against tornado-core's verifier, with public inputs in verifier order; a tampered recipient fails.
    * Groth16 r and s are fresh from a CSPRNG.
    * Deposit secrets are keccak(BIP-32 child ‖ chainId ‖ pool) masked to 248 bits, with no reuse across pools or chains.
* **Privacy Pools crypto:**
    
    * calculateContext equals upstream PrivacyPool.sol.
    * Commitment = poseidon(value, label, poseidon(nullifier, salt)).
    * State roots are recomputed from leaves and checked against the 64-entry on-chain history; the ASP check is exact equality with latestRoot.
    * Proof encoding (8 and 4 public signals, pB swap) matches.
    * In paymaster mode, recipient, fee and refund recipient are built locally.
    * The signature scheme uses tagged keccak truncated to 31 bytes and low-s normalisation, and deposit and change indices never collide.
* **Tornado relayer and paymaster checks:**
    
    * Relayer registry checks: registered, at least 40 TORN, https only, service fee in \[0.01, 0.30).
    * Recipient, relayer and fee are public proof inputs, so a relayer cannot redirect a Tornado withdrawal.
    * The paymaster adapter enforces relayer == paymaster.
* **State export:** exported state and storage exclude note secrets, apart from imported legacy notes (TCC-5).
* **CLI:**
    
    * AES-256-GCM with a fresh IV per write, and PBKDF2-SHA256 at 310k iterations with a random salt.
    * Secret files require 0600, refuse symlinks and check dev/ino.
    * Wallet names are sanitised.
    * The RPC chain ID is checked against the wallet type.
    * 7702 authorizations use a non-zero chain ID.
    * Nothing broadcasts without --broadcast, and prompts default to No.
    * USD prices come from on-chain Chainlink and Uniswap.
    * Tor bootstrap fails closed.
* **Supply chain:**
    
    * Trusted publishing (OIDC), with no long-lived npm token, and SLSA provenance on current alphas.
    * The lockfile is integrity-pinned.
    * No plaintext secrets in history or in the tarballs.
    * Published plugins and provider match the repo.

## Recommended order of fixes

1. **C1:** pin and verify the Tornado artifacts in the plugin and the CLI cache; replace the eval-based witness generator.
2. **C2 and H1:** implement validateWithdrawalData (decode and check recipient and fee), and cap Tornado relayer fees against an independent price.
3. **H3:** static pool and instance allowlists in the Tornado plugin; deposit-target checks in the CLI.
4. **H2:** client-side caps on bundler gas price and limits, plus a maximum fee as a percentage of the note; the CLI shows the proof-bound Tornado fee.
5. **H8:** per-plugin keystore allowlists, which turns C1-class bugs from wallet compromise into note compromise.
6. **H4, H5, H6:** privacy transport fixes in the CLI and the history API.
7. **H7, and the sync-integrity mediums:** recompute ASP roots, use a single sync head with gap and reorg handling, sign snapshot and saga manifests.
8. **CI:** run unit projects on every PR, fix the stale tornado-cash tests, pin actions by SHA, guard the release job.