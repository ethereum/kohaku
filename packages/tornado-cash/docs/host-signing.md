# Host-controlled Tornado delegation signing

Paymaster unshields can select `delegation: { mode: 'external', signer }`.
`signer` implements the exported `DelegatorAccount` interface: a fixed EOA
`address`, asynchronous `signAuthorization`, and asynchronous `signTypedData`.
The host may implement these using a compatible wallet, hardware signer, or
remote signer. External mode never requests a delegator private key; note-secret
discovery and proof generation remain unchanged.

```ts
await protocol.prepareUnshield(assetAmount, receiver, {
  mode: 'paymaster',
  gasEstimationPolicy: 'required',
  delegation: {
    mode: 'external',
    signer: {
      address: receiver,
      signAuthorization: request => hostAuthorizeDelegation(request),
      signTypedData: request => hostSignUserOperation(request),
    },
  },
  // Optional for a receiver that IS the executor: keep its proceeds/refunds
  // there instead of synthesizing a redundant transfer back to itself.
  tailCalls: async () => [],
});
```

The two `host...` functions above are application callbacks, not wallet RPC
method names. `signAuthorization` must return a real EIP-7702 authorization
for the requested chain, executor implementation and EOA nonce.
`personal_sign` and EIP-712 signing cannot replace that authorization.
`signTypedData` receives the exact EntryPoint v0.8 PackedUserOperation typed
data; a compatible EOA wallet can sign it using its typed-data interface.

## Boundary and verification

Public options contain the signer; worker options contain only its address.
A separate top-level host-bridge argument exposes only the two signing methods.
It permits authorization only for the selected network, current EOA nonce and
SDK Simple7702 implementation. Typed-data requests are limited to the canonical
PackedUserOperation schema, selected chain, EntryPoint, sender, paymaster and
EntryPoint nonce zero. Other signer methods and all signer fields are inaccessible.

The worker verifies returned authorization fields and recovers both signatures
against the selected EOA. A wallet account switch, incorrect signature, altered
authorization or rejection aborts preparation without fallback to another key.
External signing always requires successful bundler estimation. Deterministic
and random delegation options retain their previous behavior.

This boundary does not replace host user consent: the host must decode/review
calldata, recipients, proof-bound fees and gas limits before approving signatures.
The protocol still uses EntryPoint nonce zero. External EOAs may have prior
ordinary transactions: their current EOA nonce is used for authorization; a
used EntryPoint nonce fails simulation. Integrators may require a fresh EOA.

## Expected wallet UX

1. Select notes and a network; connect/select a receiver EOA held by the wallet.
2. Verify the account and chain, and that the wallet can authorize the SDK's
   particular EIP-7702 implementation. Show what will be delegated and the
   host's fee/gas limits before starting signing.
3. Sync/prove, then ask the wallet to authorize delegation once. Authorization
   is cached for this preparation only; the selected address is pinned.
4. Ask the wallet to sign each exact UserOperation needed for fee/gas refinement
   (up to three with the present estimator). Requests are awaited sequentially.
   Signed candidates are sent to the bundler for estimation. Treat each wallet
   signature as approval to spend at those terms: the SDK does not call send
   during preparation, but a bundler possessing the signature can submit it.
   Rejection stops further preparation; it cannot revoke a previously shared
   valid candidate signature.
5. Review the final fee and proceeds, then submit the single returned operation.
   This later button is not a cryptographic broadcast gate for candidates the
   wallet already signed and shared during estimation.

This API is enabling work, not a generic injected-wallet adapter. In the viem
version used here, `walletClient.signAuthorization` requires an account exposing
`signAuthorization`; it rejects generic JSON-RPC accounts. Wallets can restrict
which delegation implementations they authorize. A Safe is not an EOA signer
for this path. Applications must capability-check and report unsupported wallets
without requesting their private key as an automatic fallback.

The authorization is cached once per preparation. Typed-data signatures cannot
be reused after gas or fee changes. A one-final-signature estimator would be a
separate change requiring proof of bundler and pre-verification-gas compatibility.
No wallet integration or package publication is included with this SDK change.

Validation: package source typecheck and browser/Node worker/declaration builds
pass. The 50 focused signing, worker-boundary and existing host-bridge tests
pass. The full unit suite has ten pre-existing failures in
`root-verification.test.ts` and `verify-roots-thunk.test.ts`, reproduced against
the unchanged commit in a temporary checkout. No funded operation was broadcast.

References: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702),
[viem authorization signing](https://viem.sh/docs/eip7702/signAuthorization),
[Ethereum wallet integration guidance](https://ethereum.org/roadmap/pectra/7702).
