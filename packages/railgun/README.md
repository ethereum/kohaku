# @kohaku-eth/railgun

Railgun wallet plugin for the [Kohaku host and plugin interface](https://ethereum.github.io/kohaku/getting-started). The package wraps the current `kohaku-rs` Railgun WASM wallet, runs it in a Node worker thread or browser Web Worker, and provides shield, transfer, unshield, PPOI, and ERC-4337 broadcasting APIs. Ethereum mainnet and Sepolia are configured.

The package is undergoing audits. The [Railgun developer guide](https://ethereum.github.io/kohaku/railgun) covers integration, key paths, encrypted checkpoints, PPOI, and private operation recovery.

## Use the plugin

```ts
import { createRailgunBroadcaster, createRailgunPlugin } from '@kohaku-eth/railgun'

const railgun = await createRailgunPlugin(host, {
  rpcUrl,
  bundlerUrl,
  accountIndex: 0,
  accountSigningPath: "m/44'/60'/0'/0/0",
})

const publicOperation = await railgun.prepareShield({
  asset: { __type: 'native' },
  amount: 10_000_000_000_000_000n,
})
// Sign and confirm publicOperation.txns in order with the public account.

const balances = await railgun.balance()
const recipient = executionAccountAddress // address of accountSigningPath
const privateOperation = await railgun.prepareUnshield({
  asset: { __type: 'native' },
  amount: 1_000_000_000_000_000n,
}, recipient)
const submitted = await createRailgunBroadcaster(host).broadcast(privateOperation)
const receipt = await submitted.wait()
if (!receipt.success) throw new Error('Railgun UserOperation reverted')
await railgun.sync()
railgun.close()
```

The host supplies a chain provider, `network.fetch`, a keystore, and private storage. All worker HTTP requests go through `host.network.fetch`, including RPC, Subsquid, PPOI, circuit downloads, and bundler estimation. The broadcaster uses it too. The host provider and `rpcUrl` must be on the same chain.

`accountIndex` derives the Railgun spending and viewing keys at `m/44'/1984'/0'/0'/{index}'` and `m/420'/1984'/0'/0'/{index}'`. `accountSigningPath` is a separate EOA key used to sign EIP-7702 UserOperations. Keep all three recoverable. The bundler must support state overrides for `eth_estimateUserOperationGas`.

The plugin encrypts and authenticates its secret checkpoint before saving it in `host.storage` after sync, PPOI processing, and operation preparation. Persist writes atomically and keep the storage namespace private. A submitted PPOI proof is not yet `Valid`; sync again and wait for list inclusion before spending. Old CLI `rg-storage.json` checkpoints are not imported automatically.

For ERC-20 shields, `prepareShield` includes approval calls before Railgun deposit calls. For native unshield or an unshield with `tailCalls`, the recipient must be the signing EOA. `prepareUnshield` takes the exact recipient amount and Rust adds the Railgun treasury fee. Inspect `receipt.success` after `wait()`; bundler acceptance alone is not transaction success.

`RailgunWorkerWallet` exposes a lower-level worker wallet when you need explicit checkpoint persistence and fetch callbacks. It does not add the plugin's encryption envelope, so callers must encrypt and authenticate their own checkpoints. The package also exports bundler helpers and their types.

## WASM source and packaging

`vendor/wasm/node` and `vendor/wasm/web` contain release-mode `wasm-bindgen` output from `kohaku-rs`. Consumers do not need Rust or Cargo. The Node generated JavaScript is CommonJS and is scoped by `vendor/wasm/node/package.json`; the package's own entry and workers are ESM. The Node/browser conditional loader chooses the matching worker.

`vendor/wasm/provenance.json` records the base Rust commit, source tree digest, optional `source.patch` for uncommitted Rust changes, tool version, and checksums of both generated bundles and declarations. To regenerate from a `kohaku-rs` checkout, install the `wasm32-unknown-unknown` target and the exact `wasm-bindgen` CLI version in `crates/Cargo.lock`, then run:

```sh
KOHAKU_RS_DIR=/path/to/kohaku-rs WASM_BINDGEN_BIN=/path/to/wasm-bindgen pnpm build:wasm
node scripts/check-wasm-provenance.mjs
pnpm build
pnpm test
npm pack --dry-run
```

The normal package build and Changesets release use the checked-in generated WASM; they do not need a sibling Rust checkout. Rebuild and review the provenance if the Rust source changes before publishing. `prepack` verifies the vendored files and builds the TypeScript output.
