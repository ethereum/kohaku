# Plugin Implementation (`plugin.ts`)

## Architecture

Two-file plugin: `plugin.ts` (core logic) + `storage-adapter.ts` (persistence bridge).

## Key Derivation

BIP-44 paths with custom coin type `1985` (placeholder for SLIP-0044 registration):

- **Spending key:** `m/44'/1985'/0'/0'/{keyIndex}`
- **Viewing key:** `m/44'/1985'/0'/1'/{keyIndex}`

Keys derived from `host.keystore.deriveAt()`, `0x` prefix stripped because Go WASM expects raw hex.

## `createCurvyPlugin()` — Factory Function

1. Derives spending + viewing keys from host keystore
2. Creates `HostStorageAdapter` wrapping host's sync key-value store
3. Initializes `CurvySDK` with environment, API URL, storage adapter, and host's fetch
4. **Chain validation** — checks host's chain ID against SDK's supported networks, throws `UnsupportedChainError` if mismatch
5. **Auth** — if `curvyId` provided → `registerWalletWithPrivateKeys()`, otherwise → `addWalletWithPrivateKeys()` (login)
6. All SDK errors wrapped through `wrapSdkError()`

## `CurvyPlugin` Class — 6 Methods

| Method | Type | What it does |
|---|---|---|
| `instanceId()` | Read | Returns active wallet's curvy handle |
| `balance(assets?)` | Read | Calls `sdk.getBalances()`, aggregates by currency address, optionally filters by asset ID list |
| `prepareShield(asset)` | Write | Generates entry portal via SDK, returns `PublicOperation` with on-chain tx (native ETH = value transfer, ERC-20 = encoded `transfer()` calldata) |
| `prepareTransfer(asset, to)` | Write | Validates curvy ID, checks balance, calls `sdk.estimate()` with type `curvy-transfer`, returns `PrivateOperation` with `EstimatedPlan` |
| `prepareUnshield(asset, to)` | Write | Validates EVM address, checks balance, calls `sdk.estimate()` with type `external-transfer`, returns `PrivateOperation` with `EstimatedPlan` |
| `broadcast(op)` | Write | Executes `EstimatedPlan` via `sdk.execute()`, checks `result.success`, wraps errors |

## Error Mapping (`wrapSdkError`)

Central error translator — no raw SDK errors leak through plugin interface:

- `APIError 404` → `InvalidAddressError`
- `APIError 409` → descriptive `[Curvy] Error`
- `AnnouncementSyncError` → `[Curvy] balance sync failed`
- `StorageError` → `[Curvy] storage error`
- **Pattern-matched messages:** unregistered address, wrong keys, handle taken, recipient not found, unsupported aggregation, insufficient balance
- **Fallback:** generic `[Curvy] ctx: msg`

---

# Storage Adapter (`storage-adapter.ts`)

Bridges Kohaku's sync `Storage` (`get`/`set` string) to SDK's async `StorageInterface`:

- 5 in-memory Maps: wallets, currencies, prices, balances, totals
- All namespaced under `curvy:` prefix
- BigInt serialization via `__bigint__` wrapper in JSON
- **Write-through:** every mutation persists to host storage
- Loads existing state on construction (survives across plugin recreations)
- No key material stored — re-derived each time
- Balance tracking with delta-based total updates

---

# Type System

- `CurvyPrivateOperation` = `PrivateOperation & { estimatedPlan }` — consumed on broadcast
- `CurvyPublicOperation` = `PublicOperation & { txs: ShieldTx[] }` — on-chain txs for user to sign
- `CurvyInstance` — typed plugin interface declaring which features are enabled (shield/transfer/unshield single-asset = `true`, multi-asset = `false`)

---

# Test Coverage (`plugin.test.ts`)

## Test Infrastructure

- 3 host mocks: `makeTestHost()` (keys 1), `makeTestHost2()` (keys 2, separate vault), `makeWrongChainHost()` (chain 9999)
- `freshIdentity()` — random EVM keypair + unique curvy handle per test run
- `anvilRpc()` / `fundPortal()` — direct Anvil RPC for on-chain funding
- `pollForNativeBalance()` — polls balance with configurable timeout/interval

## 7 Test Suites

| Suite | Tests | What's covered |
|---|---|---|
| Phase 1: Creation + Auth | 4 | Registration returns plugin + correct `instanceId`; Login (no `curvyId`) returns plugin + same `instanceId` |
| Phase 3: Balance queries | 5 | `balance(undefined)` returns array with correct shape; `balance([])` → empty; native filter works; unknown ERC-20 → empty |
| Phase 4: Shield flow | 2 | `prepareShield(native)` returns valid portal address + value tx; unsupported asset → `UnsupportedAssetError` |
| Phase 4: Shield E2E | 1 | Full lifecycle: prepareShield → fund portal via Anvil → poll until backend credits balance |
| Phase 5: Transfer flow | 3 | Invalid curvy ID → `InvalidAddressError`; unsupported asset → `UnsupportedAssetError`; zero balance → `InsufficientBalanceError` |
| Phase 5: Transfer E2E | 2 | Shield → wait → prepareTransfer → broadcast → sender balance decreases, recipient balance increases |
| Phase 6: Unshield flow | 3 | Invalid address → `InvalidAddressError`; unsupported asset → `UnsupportedAssetError`; zero balance → `InsufficientBalanceError` |
| Phase 6: Unshield E2E | 2 | Shield → wait → prepareUnshield → broadcast → private balance decreases |
| Phase 7: Error mapping | 2 | Wrong chain → `UnsupportedChainError` with correct `chainId` |
| Auth error wrapping | 2 | Unregistered login → descriptive `[Curvy]` error (not raw SDK); duplicate handle → descriptive error |

**Total:** ~26 tests across unit validation and E2E flows

E2E tests need running Anvil + Curvy backend (`pnpm dev`). Timeouts range 10s–180s depending on backend processing time.
