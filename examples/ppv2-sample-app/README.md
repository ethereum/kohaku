# Privacy Pools v2 × Kohaku — sample wallet integration

A runnable walkthrough of how a Kohaku-based wallet (e.g. the extension)
integrates the Privacy Pools v2 plugin from `@kohaku-eth/privacy-pools`.

Two modes share the same wallet-side integration code:

- **`checks/` (`pnpm check:<name>`) — live Sepolia**, one standalone script
  per plugin verb (mirroring the v2-monorepo's `apps/sample/checks` layout):
  real contracts, real ASP, real relayer, real Groth16 proofs, with explicit
  post-condition assertions. Needs a funded key in `.env`.
- **`src/devnet-main.ts` (`pnpm start:devnet`) — offline demo**: the full
  lifecycle in one run against an in-process devnet; runs in milliseconds
  with no configuration.

```sh
# from the repo root
pnpm install
pnpm --filter @kohaku-eth/privacy-pools --filter @kohaku-eth/plugins --filter @kohaku-eth/provider build
pnpm --filter @kohaku-eth/ppv2-sample-app start:devnet
```

Set `DEVNET_TRACE=1` to log every `eth_call` the plugin makes and the
protocol leaves the devnet mints.

## What it demonstrates

The demo drives the full lifecycle through the public plugin surface only:

| Step | Wallet call | What happens |
|---|---|---|
| construct | `createPPv2Plugin(host, params)` | keys derive from the host keystore (EIP-712 signature over the PPv2 signer path); no raw key material is ever injected or persisted |
| register | `prepareRegisterKeystore()` → wallet signs+sends | one-time on-chain `setAuthPolicy` + `setViewingKey`, sent from `ownerAddress` (msg.sender-bound) |
| shield | `prepareShield(asset)` → wallet signs+sends | plugin returns ready-to-sign `TxData[]` (approve + deposit for ERC20); it never signs (INV-1) |
| read | `balance()` / `notes()` | every read syncs incrementally from chain events first; deposits appear once mined |
| transfer | `prepareTransfer(asset, to)` → `createPPv2Broadcaster(plugin).broadcast(op)` | note selection + transact witness + cheapest live relayer quote; broadcast re-proves, relays, and reconciles spent/change notes; the cold-start payload carries the recipient's note out-of-band |
| unshield | `prepareUnshield(asset, to)` → broadcast | same relayer path; payout routing is bound into the proof |
| backup | `exportAccount()` / `importAccount(blob)` | portable blob with notes + sync cursor, no raw keys; fresh-device construction re-runs the rotation-index gap scan against the on-chain registration |

## Layout — which code is "real"

- **`src/wallet/`** — the integration a wallet would actually ship. Imports
  only `@kohaku-eth/plugins`, `@kohaku-eth/privacy-pools`, and
  `@kohaku-eth/provider` — never `@0xbow-io/privacy-pools-v2-sdk` (SC-001). Host
  assembly, transacting-account signing, plugin parameters.
- **`src/devnet/`** — demo plumbing standing in for Sepolia, the ASP, the
  relayer, and the Groth16 prover so the demo runs offline and in
  milliseconds. It emits the same events the real contracts would (encrypted
  `Note` payloads the plugin genuinely decrypts, real auth digests for the
  registration gap scan) and is injected through `PPv2Factories`, the
  plugin's documented seam. This side *does* import the SDK — it plays the
  protocol infrastructure, not the wallet.

## Live Sepolia checks (`checks/`, shared wiring in `src/live/session.ts`)

Each check is a standalone script against the real V2 Sepolia deployment
(proxies pinned in `src/live/session.ts`, matching the SDK's `DEPLOYMENTS`
map), the real 0xbow staging ASP (`api-dev.0xbow.io`) and staging relayer,
with real Groth16 proofs from the locally built circuits in the v2-monorepo:

```sh
cp .env.example .env        # then set SEPOLIA_PRIVATE_KEY (funded key)
pnpm check:read                       # read path only; sends nothing
pnpm check:register                   # one-time keystore registration
pnpm check:shield 1000                # deposit (amount in wei)
pnpm check:unshield 1000000000000000  # relayed withdrawal (needs approved note)
pnpm check:transfer                   # relayed cold-start transfer (see note below)
pnpm check:ragequit                   # public exit of one note
pnpm check:exportImport               # backup/restore onto a fresh device
```

- Each check asserts its post-conditions (registration visible, note
  discovered, input spent, restored balance equal, …) and exits nonzero on
  violation — `✓ <name> ok` otherwise.
- State (sync cursor, discovered notes, key-rotation index) persists in
  `.ppv2-live-store.json` (gitignored), so re-runs are incremental. When the
  deployment addresses change, delete the store — its notes and cursor refer
  to the old contracts.
- Proving artifacts fetch from IPFS by default (digest-checked against the
  full pinned Sepolia manifest in `src/wallet/config.ts` — no dev seams
  left). Set `CIRCUITS_DIR` to a local v2-monorepo circuits build to skip
  the multi-MB proving-key downloads on every run. Deposits are screened by
  the actual ASP and become spendable once approved.
- **Known-blocked upstream**: `check:transfer` currently fails at the relayer
  with `PoolVault_ProofContextMismatch()` — a transfer-payload encoding skew
  between SDK 0.1.0-beta.0 and the deployed staging stack (withdrawals relay
  fine, which isolates it). The check documents the expected failure.

## Devnet approximations (things a real chain does differently)

- A mined deposit's note secrets never leave the SDK, so the devnet mints an
  *equivalent* fresh note of the same value to the same owner; on the real
  chain the Entrypoint emits exactly the note the plugin prepared.
- The devnet never emits `Transact`/`Ragequit` events, so spent/change state
  after a relay comes from the session's own persistence (as it does live —
  chain events only corroborate later). A from-scratch re-scan on the devnet
  would therefore overstate balances; use `exportAccount`/`importAccount` for
  device moves, which is the supported flow anyway.
- Proofs are dummy shapes from a stub prover; all commitments, note
  encryption, witnesses, selection, quotes, and state reconciliation run the
  real SDK pipeline.
