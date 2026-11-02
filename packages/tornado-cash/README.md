# @kohaku-eth/tornado-cash

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

Cross-platform Tornado Cash Typescript SDK with support for kohaku's standard interfaces.

## Installation

```sh
pnpm add @kohaku-eth/tornado-cash
```

## Random paymaster delegation

`delegation: { mode: 'random' }` discards the sender's private key. Do not use it in production unless you deliberately accept irreversible loss of any balance left there. Every sponsored withdrawal pays the sender before execution, including a single note. Failed, empty, or incomplete `tailCalls` can permanently strand the net payout. An unused gas-fee refund arrives after execution and is also unrecoverable even when forwarding succeeds. Prefer the default deterministic delegation.
