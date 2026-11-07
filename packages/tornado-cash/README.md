# @kohaku-eth/tornado-cash

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Tornado Cash Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/tornado-cash
```

## Random paymaster delegation

> **`delegation: { mode: 'random' }` is safe ONLY for a single-note withdrawal with no `tailCalls`. It is UNSAFE for ALL multi-note withdrawals and ANY withdrawal with `tailCalls`.**

The safe single-note path uses `callGasLimit = 0` and pays both the withdrawal and its unused gas-fee refund directly to the requested recipient. Neither is routed through the throwaway sender. The SDK tries bundler estimation first. On mainnet/Sepolia, the default `gasEstimationPolicy: 'best-effort'` can return marked fallback gas if estimation is unavailable or the estimator substitutes incompatible nonzero execution gas. No host-RPC simulation or state overrides are required. Use `'required'` to require successful bundler estimation. Fallback is not a guarantee of bundler acceptance or a gas refund; review its fee before submission.

Multi-note withdrawals and withdrawals with `tailCalls` pay the sender before execution. An execution failure can permanently strand the sponsoring note's proceeds; a later gas refund can also be inaccessible even when forwarding succeeds. The random key is discarded, so successful estimation does not make these paths safe. Use a securely recoverable deterministic or external signer instead.

A single UserOperation can spend multiple notes. Omit `tailCalls` entirely for the safe single-note path; even an empty callback is unsafe. The SDK does not currently reject unsafe random delegation automatically, so integrators must enforce this restriction. See [delegation options](../../docs/pages/tornado-cash/options.mdx#delegation).


## Execution accounts for sponsored withdrawals

The default remains a recoverable EIP-7702 sender delegated to Simple7702Account.
You can select another compatible implementation with `delegation.implementation`,
or use an external EOA owner of an eth-infinitism **SimpleAccount v0.8.0**:

```ts
import type { DelegationConfig } from '@kohaku-eth/tornado-cash';

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
