# @kohaku-eth/privacy-pools

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Privacy Pools Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/privacy-pools
```

## Random paymaster delegation

`delegation: { mode: 'random' }` discards the sender's private key. Do not use it in production unless you deliberately accept that funds left on this sender can never be recovered. A single-note withdrawal without `tailCalls` pays the recipient during validation. With `batch` or `tailCalls`, the withdrawal pays the sender first; failed, empty, or incomplete execution can permanently strand the net payout. Prefer the default deterministic delegation.
