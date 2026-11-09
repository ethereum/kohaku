# @kohaku-eth/tornado-cash

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Tornado Cash Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/tornado-cash
```

## Single-note payouts and batch execution

Every single-note paymaster withdrawal without `tailCalls` pays the requested
recipient directly during validation, with `callData: '0x'` and `callGasLimit: 0`. The paymaster sends
any unused gas-fee refund to that same recipient. This applies to all supported
7702 implementations and deployed or factory-created smart-account senders.
Neither withdrawal proceeds nor refunds pass through an intermediate execution
account. If the caller explicitly chooses the sender as the recipient, it receives
the payout and refund directly as the requested destination.

Single-note withdrawals with `tailCalls` use the execution account as an
intermediate recipient, then execute those calls with the withdrawal funds.
An explicitly supplied empty callback also selects this execution path and
suppresses automatic forwarding. Keep control of the 7702 sender or smart account
to recover leftovers, failed-execution proceeds and later gas refunds.

For a batch or single note with tail calls, the sponsoring note pays the execution
sender during validation; remaining notes are withdrawn in execution, followed by the supplied `tailCalls`
or an automatic forward to the requested destination. Tornado gas refunds go to
the sponsoring proof's recipient, so batch refunds remain in the execution
account even after forwarding. Use an account you can recover.

## Random paymaster delegation

> **`delegation: { mode: 'random' }` is safe ONLY for a single-note withdrawal without `tailCalls`. It is UNSAFE for ALL multi-note withdrawals and ANY withdrawal with `tailCalls`.**

The safe single-note path uses `callGasLimit = 0` and pays both the withdrawal and its unused gas-fee refund directly to the requested recipient. Neither is routed through the throwaway sender. The SDK tries bundler estimation first. On mainnet/Sepolia, the default `gasEstimationPolicy: 'best-effort'` can return marked fallback gas if estimation is unavailable or the estimator substitutes incompatible nonzero execution gas. No host-RPC simulation or state overrides are required. Use `'required'` to require successful bundler estimation. Fallback is not a guarantee of bundler acceptance or a gas refund; review its fee before submission.

Multi-note withdrawals and withdrawals with `tailCalls` pay the sender before execution. An execution failure can permanently strand the sponsoring note's proceeds; a later gas refund can also be inaccessible even when forwarding succeeds. The random key is discarded, so successful estimation does not make these paths safe. Use a securely recoverable deterministic or external signer instead.

A single UserOperation can spend multiple notes. Omit `tailCalls` entirely for the safe single-note path; even an empty callback selects execution. The SDK does not reject unsafe random delegation automatically, so integrators must enforce this restriction. See [delegation options](../../docs/pages/tornado-cash/options.mdx#delegation).

## Execution gas recovery

Successful bundler estimates normally refine gas limits and rebuild the fee,
proof and signature. If estimation fails with a recognized execution-gas
shortage, preparation stops by default. Setting a gas ceiling alone does not
enable retries.

For execution calls with either a compatible 7702 sender or a smart account, opt in with:

```ts
const options = {
  mode: 'paymaster' as const,
  executionGasRetry: true,
  maxGasLimits: { callGasLimit: 8_000_000n }, // illustrative absolute ceiling
};
```

`executionGasRetry` defaults to `false`; `true` requires a positive
`maxGasLimits.callGasLimit`. At most three extra probes double the current
execution budget without exceeding that ceiling. Every changed budget re-quotes
the fee, re-proves the sponsoring note and requests a new signature. A successful
larger probe is tightened to the estimate plus 20%, never below the original
baseline, then rebuilt and successfully estimated again before return.

This can add proving time and wallet signature prompts. Higher fees reduce the
funds available to custom calls. Funding, allowance, validation, contract-revert
and unknown errors do not trigger larger budgets. Single-note operations without
tail calls keep zero execution gas even when retry is enabled. These estimation
retries do not call `eth_sendUserOperation`, but the bundler receives signed
candidates and could submit them. `tailCallsGasEstimate` remains an optional initial
execution estimate, independently of the retry policy and absolute ceiling.


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
