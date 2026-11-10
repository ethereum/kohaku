# @kohaku-eth/privacy-pools

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Privacy Pools Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/privacy-pools
```

## Several accounts

By default each plugin instance loads, syncs and saves its own copy of the chain state, although that state is the same for every account. Give every account the same `chainStorage` object to keep a single copy, in memory and in storage:

```ts
const chainStorage = createChainStorage(); // any Storage, created once

const first = createPPv1Plugin(hostA, { accountIndex: 0, entrypoint, broadcasterUrl, chainStorage });
const second = createPPv1Plugin(hostB, { accountIndex: 1, entrypoint, broadcasterUrl, chainStorage });
```

Sharing follows the object: accounts given different storage objects keep separate copies, even if they write to the same place. Whichever account syncs reads the chain through its own provider and every account relies on the result, so only share a chain storage between accounts that use the same provider.

Accounts keep their notes and secrets in memory only; they are derived again on every load.

## Storage keys

The plugin saves JSON under these keys, in `chainStorage` when it is set and otherwise in `host.storage`. Both hold public data, the same for every account. The values belong to the plugin: route the keys where you like, but do not parse or edit the values.

| Key | Builder | Holds |
|---|---|---|
| `privacy-pool-state-v2-<chainId>-<entrypoint>` | `getPPv1ChainStateKey` | Public chain state |
| `privacy-pool-timestamps-<chainId>-<entrypoint>` | `getPPv1TimestampsKey` | Block timestamps for `history()` |

Nothing is saved per account. States saved by earlier versions, under `privacy-pool-state-<chainId>-<entrypoint>`, and their history entries are no longer read: the chain is synced again, from the `initialState` snapshot if one is given. Snapshots and `dumpState()` keep the key without the version.

## External paymaster signing

Paymaster unshields accept `delegation: { mode: 'external', signer }`. The exported
`DelegatorAccount` type supplies a fixed EOA `address` and asynchronous
`signAuthorization` / `signTypedData` callbacks. These let the host request
delegation and UserOperation signatures from a compatible wallet or remote signer
without giving the SDK the delegator's private key.

This works with single-note, `batch`, tail-call and exact-output unshields.
Returned signatures are checked against the selected EOA; authorization is cached
during one preparation. External mode requires successful bundler estimation of
the final signed payload. Existing deterministic/random modes retain their
current behavior.

## Random paymaster delegation

`delegation: { mode: 'random' }` discards the sender's private key. Do not use it in production unless you deliberately accept that funds left on this sender can never be recovered. A single-note withdrawal without `tailCalls` pays the recipient during validation. With `batch` or `tailCalls`, the withdrawal pays the sender first; failed, empty, or incomplete execution can permanently strand the net payout. Prefer the default deterministic delegation.
