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


## Execution accounts for sponsored withdrawals

The default remains a recoverable EIP-7702 sender delegated to Simple7702Account.
You can select another compatible implementation with `delegation.implementation`,
or use an external EOA owner of an eth-infinitism **SimpleAccount v0.8.0**:

```ts
import type { DelegationConfig } from '@kohaku-eth/privacy-pools';

const delegation: DelegationConfig = {
  mode: 'smart-account',
  signer: {
    address: ownerAddress,
    signTypedData: request => owner.signTypedData(request),
  },
  account: { kind: 'simple-account', address: smartAccountAddress },
  allowUsed: true, // required for an already deployed account
  // nonce: entryPointNonce, // optional assertion; otherwise read from EntryPoint
};
// Pass this delegation in the existing paymaster unshield options.
// Set the withdrawal's destination to smartAccountAddress to retain the batch there.
```

`nonce`, when supplied, is the expected full `EntryPoint.getNonce(account, key)`
value. It must match the chain; otherwise preparation stops. When omitted, the
SDK reads the current key-0 EntryPoint nonce. This is separate from the owner's
native transaction nonce. No owner private key,
`signAuthorization`, `signMessage`, or owner transaction is requested for this route.
Gas refinement can request more than one typed-data signature; review each payload.

For first-use deployment, include
`account.factory: { address: simpleAccountFactoryAddress, salt }` and use the
address returned by that factory's `getAddress(ownerAddress, salt)`. The SDK
encodes `createAccount(ownerAddress, salt)` in the UserOp's factory fields;
EntryPoint deploys the account before validation. Omit `factory` once the account
is deployed. Deployment gas is included in estimation and paid from the sponsoring
note. Factory and account addresses are supplied by the integrator; the SDK does
not deploy an implementation or vendor Solidity, bytecode, or a contract package.

For an alternative delegation implementation:

```ts
const delegation: DelegationConfig = {
  mode: 'external',
  signer: eoaSigner, // signAuthorization and signTypedData
  implementation: compatibleImplementationAddress,
  allowUsed: true, // if the EOA was already delegated, used or funded
  // nonce: entryPointNonce, // optional assertion of the current on-chain nonce
};
```

Both account families must support EntryPoint v0.8, raw ECDSA recovery of its
EIP-712 UserOp hash, `execute(address,uint256,bytes)` and
`executeBatch((address,uint256,bytes)[])` with ordered, revert-on-failure execution,
and receiving the withdrawn assets. Older SimpleAccount releases using personal
message signatures and arbitrary account ABIs are not supported. A custom 7702
target is an explicit integrator trust decision, not an SDK audit certification.
The new routes require successful bundler simulation and preserve the existing
paymaster proof formats, recipients, gas/fee bounds, and withdrawal call order.
Execution-phase withdrawals land in the UserOp sender; forwarding follows the
existing destination/tail-call rules. If destination equals sender, no redundant
self-transfer is added. Validation-phase payouts and postOp refunds can survive an
execution failure, so keep control of the execution account for recovery.

The reference account/factory are external upstream contracts:
[eth-infinitism v0.8.0](https://github.com/eth-infinitism/account-abstraction/tree/v0.8.0/contracts/accounts),
commit `4cbc06072cdc19fd60f285c5997f4f7f57a588de`.
The upstream repository includes audit reports; their scope applies to the
reviewed revisions, not to arbitrary implementations or this SDK integration.


Senders must appear untouched by default: no code/delegation, no native or
key-0 EntryPoint nonce, and no ETH balance. Set `delegation.allowUsed: true` to
explicitly opt into an existing smart account or a previously delegated/funded EOA.
State read failures stop preparation before proving/signing. The SDK always reads
the current EntryPoint nonce and, for delegation, the sender's native authorization
nonce. With an existing smart account, factory fields are omitted automatically,
even when the caller keeps its factory configuration. This preflight checks current
state; it does not enumerate ERC20 balances or detect past activity that leaves
none of these signals. Reused senders require successful bundler simulation.
