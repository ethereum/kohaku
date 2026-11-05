# @kohaku-eth/privacy-pools

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Privacy Pools Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/privacy-pools
```

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
