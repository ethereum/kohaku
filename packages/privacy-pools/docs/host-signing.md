# Host-controlled Privacy Pools unshield signing

Paymaster unshields support the same external signer option as Tornado:

```ts
import type { DelegatorAccount } from '@kohaku-eth/privacy-pools';

const signer: DelegatorAccount = {
  address: receiver,
  signAuthorization: request => hostAuthorizeDelegation(request),
  signTypedData: request => hostSignUserOperation(request),
};

const operation = await protocol.prepareUnshield(assetAmount, receiver, {
  mode: 'paymaster',
  delegation: { mode: 'external', signer },
  batch: true, // Optional: consolidate approved notes in one UserOperation.
});
```

The `host...` functions are application callbacks, not standardized wallet RPC
names. The host can implement them using a compatible wallet, hardware signer or
remote signer. There is no automatic wallet adapter or private-key fallback.
The existing `DelegatorAccount` shape is now publicly exported alongside
`DelegationConfig`.
Factory-created `PPv1Instance` and `PPv1LegacyInstance` types expose the same
protocol-specific unshield options as the concrete protocol class.

## What the SDK does

Privacy Pools' state manager executes in the host process. Its existing public
options/state-manager route can pass callbacks directly, so no worker bridge or
new cross-thread signing transport is needed.

External mode selects the host-held EOA without calling
`deriveEphemeralSigner` or `deriveDelegatorSigner`. Note-secret discovery and
proof generation are unchanged; this option replaces the delegation/UserOperation
signing key, not the privacy-note keys.

The SDK reads that EOA's current transaction nonce for its EIP-7702 authorization.
Its EntryPoint nonce remains zero (the current single-use UserOperation policy).
Authorization requests are restricted to that nonce, the selected chain and the
SDK's Simple7702 implementation. Typed-data requests are restricted to the canonical
PackedUserOperation schema, selected chain, EntryPoint, EOA, paymaster and nonce.
Unrelated message types and wallet account overrides are rejected before calling
the host.

The SDK recovers returned signatures and checks them against the pinned EOA and
requested authorization fields. A switched account, changed payload, invalid
signature or user rejection stops preparation, with no derived-key fallback.
The host must still review calldata, recipients, proof-bound fees and gas limits
before approving each request; protocol scoping does not replace user consent.

The authorization is cached for one preparation. Gas refinement changes the
UserOperation, so the current flow normally requests two typed-data signatures:
one candidate for estimation and the rebuilt candidate at the refined fee.
Both bundler estimation passes must succeed in external mode. If the final
candidate needs more gas than it carries, preparation fails instead of silently
patching an already-signed operation. Existing deterministic/random modes retain
their best-effort gas behavior.

## Wallet UX

1. Select the asset, amount and recipient; connect/select the EOA that will be the
   UserOperation sender. The recipient may be this EOA or another address.
2. Read-only `estimateUnshield` can show an initial fee without signing. Pin the
   wallet account/network, check authorization support for the SDK executor, and
   explain the fee/gas limits before requesting signatures.
3. Ask the wallet to authorize delegation once, then sign the provisional and
   refined UserOperation requests sequentially. The SDK awaits the host each time.
4. Show the returned operation's final fee and payout/refund recipients, then
   submit it through the existing paymaster broadcaster.

Preparation sends fully signed candidates to the selected bundler for estimation.
Those wallet signatures are spend approval: although preparation itself does not
call `eth_sendUserOperation`, the bundler can submit a valid candidate it already
holds. A later Submit button is not a cryptographic broadcast gate, and rejecting
a subsequent request cannot revoke an earlier shared signature.

Wallet support is a separate integration requirement. The pinned viem
`signAuthorization` action requires an account exposing authorization signing and
rejects generic JSON-RPC accounts. Typed-data signing alone cannot create an
EIP-7702 authorization, and a Safe is not the EOA signer for this path. The host
must not silently request a private key when a wallet lacks support.

## Existing payout semantics

- Single-note withdrawals without tail calls pay the chosen recipient in
  paymaster validation.
- A batch or tail calls pays the sender first. Batches forward the consolidated
  payout to the chosen recipient when no user tail calls are supplied. Custom
  tail calls retain responsibility for spending/forwarding the sender's funds.
- `refundRecipient` still defaults to the chosen recipient. Exact-output
  paymaster unshields still require it explicitly.
- Note selection, ASP approval, proof generation, partial withdrawals, exact-output
  sizing and relayer-mode unshields keep their existing behavior.

These changes include SDK support and tests only. No connected-wallet UI,
version bump, changeset, publication or funded operation is included.
