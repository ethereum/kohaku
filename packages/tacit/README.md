# @kohaku-eth/tacit

> [!IMPORTANT]
> THIS PACKAGE IS NOT READY FOR PRODUCTION USE AND CONTAINS UNAUDITED CODE. USE WITH CAUTION AND ENTIRELY AT YOUR OWN RISK. POSSIBILITY OF BREAKING CHANGES IN SUBSEQUENT VERSIONS.

TypeScript SDK for the Tacit EVM shielded pool with support for kohaku's standard interfaces: shield, private transfer and unshield of ETH on Ethereum, Base, Robinhood Chain and MegaETH.

The pool holds ETH as notes of any amount. Proofs are made on the user's device, a relayer can submit a spend so the user needs no gas, and the contracts are immutable. See the [pool guide](https://github.com/src-company/tacit/blob/main/docs/EVM-POOL.md).

## Installation

```sh
pnpm add @kohaku-eth/tacit
```

## Usage

```ts
import { createTacitBroadcaster, createTacitPlugin, E_ADDRESS } from '@kohaku-eth/tacit'

const tacit = await createTacitPlugin(host)
const eth = { __type: 'erc20' as const, contract: E_ADDRESS }

const { txns } = await tacit.prepareShield({ asset: eth, amount: 10n ** 16n }) // sent by the user's account
const payment = await tacit.prepareTransfer({ asset: eth, amount: 10n ** 15n }, recipientAddress)
const withdrawal = await tacit.prepareUnshield({ asset: eth, amount: 10n ** 15n }, '0x…')

await createTacitBroadcaster(host).broadcast(payment) // submitted by the relayer
```

See the docs for the [host](https://ethereum.github.io/kohaku/host), [configuration](https://ethereum.github.io/kohaku/tacit/configuration), and [relayers and fees](https://ethereum.github.io/kohaku/tacit/operations).

## Tests

```sh
pnpm --filter @kohaku-eth/tacit test:unit
RPC_URL_MAINNET=<archive node> pnpm --filter @kohaku-eth/tacit test:e2e
```

The unit tests include vectors produced by the pool's reference client. The e2e tests fork Ethereum mainnet and run shield, transfer and unshield against the live pool with the ceremony's proving files, which they download or read from `TACIT_ARTIFACTS_DIR`. The fork's RPC must serve `eth_getLogs` over the pool's history.
