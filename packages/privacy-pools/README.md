# @kohaku-eth/privacy-pools

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Privacy Pools Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/privacy-pools
```

## Privacy Pools v2 plugin (alpha, UNAUDITED)

`src/v2/` ships a Kohaku plugin for [Privacy Pools v2](https://privacypools.com),
adapting the wallet's `Host` capabilities onto `@privacy-pools-v2/sdk`. The plugin
**never signs or submits transactions**: public flows (shield, registration, ragequit)
return ready-to-sign `TxData[]`; private flows (transfer, unshield) return operations a
`PPv2Broadcaster` relays.

```ts
import { createPPv2Plugin, createPPv2Broadcaster } from "@kohaku-eth/privacy-pools";

const plugin = await createPPv2Plugin(host, {
    chainId: 11155111n,
    ownerAddress,                                    // wallet account that sends public ops
    asp: { baseUrl, publicKey },                     // pin the ASP key
    relayers,                                        // at least one active relayer
    artifacts: { gatewayUrls, manifest },            // pinned circuit CIDs (mandatory)
});
const broadcaster = createPPv2Broadcaster(plugin);   // shares the plugin's session

await plugin.prepareShield({ asset: { __type: "native" }, amount });   // TxData[] for the wallet
const op = await plugin.prepareTransfer({ asset, amount }, recipient); // private op
const { txHash, coldStartPayload } = await broadcaster.broadcast(op);  // deliver payload out-of-band
```

Verbs: `prepareShield`, `prepareTransfer` (cold-start, any EVM address),
`prepareUnshield` (recipient receives `amount` net; relayer fee on top), `balance`,
`notes`; extras: `isRegistered`, `prepareRegisterKeystore`, `prepareRageQuit`
(unconditional exit), `sync`, `exportAccount`/`importAccount` (no key material — keys
always re-derive from the wallet keystore at the dedicated `m/28784'/2'` path family).

**Host wallet obligations**: send every public operation from the configured
`ownerAddress` (registration and ragequit are `msg.sender`-bound), and surface the
`coldStartPayload` returned by the broadcaster to the user for out-of-band delivery to
the recipient.

**Status / known gates** (see `.specify/specs/001-privacy-pools-v2/` for the full spec):

- Alpha and **UNAUDITED** (the banner above applies doubly here).
- `@0xbow-io/privacy-pools-v2-sdk` is published only to GitHub Packages as a beta
  (auth required even for reads — see [Development](#development)); publishing this
  package for public consumption is gated on a public npm release of the SDK.
- The SDK's `APP_IDENTIFIER` derivation constant is a placeholder (`TODO(0XB-1065)`);
  until it is frozen, derived keys are NOT durable — Sepolia only.
- Circuit-artifact CIDs must be pinned on production infrastructure and match the
  deployed verifiers; artifact fetches are digest-verified on every load.
- Targeted (on-chain-discoverable) transfers to registered recipients, deposit-for,
  multi-asset batches, and note merging are deliberate follow-ups.

## Development

This package depends on `@0xbow-io/privacy-pools-v2-sdk`, published only to GitHub
Packages — a registry that requires authentication even for reads. To keep the
monorepo installable and buildable without credentials, the SDK is declared as an
**optional dependency**: a tokenless `pnpm install` skips it (with the workspace's
`trustLockfile` setting suppressing the unauthenticated supply-chain metadata check),
and the root `pnpm build` excludes this package.

To build or test this package:

1. Create a GitHub personal access token with the `read:packages` scope. Your GitHub
   account also needs access to the `0xbow-io` packages (ask a maintainer).
2. Add it to your **user-level** `~/.npmrc` — never to the repo's `.npmrc`:

   ```ini
   //npm.pkg.github.com/:_authToken=<your token>
   ```

3. Run `pnpm install` from the repo root (now fetches the SDK), then
   `pnpm build:privacy-pools`.

**Bumping the SDK**: it is pinned to an exact version (a dist-tag such as `beta` would
force an online registry lookup on every install, breaking tokenless installs). Update
the pin in `package.json` (and in `examples/ppv2-sample-app/package.json`) and re-run
`pnpm install` with the token configured.