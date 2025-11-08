# @kohaku-eth/railgun

Simplified Railgun TypeScript SDK with support for both Ethers and Viem. Borrows code from internals of [railgun-community/engine](https://github.com/railgun-community/engine) and [railgun-privacy/contract](https://github.com/railgun-privacy/contract) (see [About Forked Libs](#about-forked-libs))

## Features

- **Provider Agnostic**: Works with both Ethers v6 and Viem v2
- **Factory Functions**: Clean, functional API inspired by Viem's design patterns
- **Type Safe**: Full TypeScript support with comprehensive type definitions
- **Transaction Builder**: SDK outputs transaction data, you control submission
- **Privacy-First**: Shield, transfer, and unshield tokens privately on Ethereum

## Installation

```sh
pnpm add @kohaku-eth/railgun
```

## Quick Start

```ts
import { createRailgunAccount, createRailgunIndexer, RAILGUN_CONFIG_BY_CHAIN_ID } from "@kohaku-eth/railgun"

const chainId = 11155111
const network = RAILGUN_CONFIG_BY_CHAIN_ID[chainId.toString()]

// Get your Railgun address
const indexer = createRailgunIndexer({
  network: network,
  startBlock: network.GLOBAL_START_BLOCK
})
const account = createRailgunAccount({
  credential: { type: "mnemonic", mnemonic: "your 12 word seed phrase here ...", accountIndex: 0 },
  indexer,
})
const address = await account.getRailgunAddress();
console.log('Railgun address:', address); // 0zk1...

// Shield ETH
const shieldTx = await account.shieldNative(BigInt('100000000000000000')); // 0.1 ETH

// Submit with Ethers
await wallet.sendTransaction({
  to: shieldTx.to,
  data: shieldTx.data,
  value: shieldTx.value,
  gasLimit: 6000000
});

// Or submit with Viem
await walletClient.sendTransaction({
  to: shieldTx.to as `0x${string}`,
  data: shieldTx.data as `0x${string}`,
  value: shieldTx.value,
  gas: 6000000n
});
```

See [full documentation](../../docs) for more examples.

## Test

create and fill `test/.env` with `SEPOLIA_RPC_URL` then run:

```sh
pnpm -F @kohaku-eth/railgun test
```

## Demo

create and fill `demo/.env` file similar to `demo/.env.example`

You need a `SEPOLIA_RPC_URL` (a sepolia RPC e.g. infura) and `TX_SIGNER_KEY` (0x prefixed private key funded with some sepolia ETH)

from monorepo root directory, after installing deps with `pnpm install`, run:

```sh
pnpm -F @kohaku-eth/railgun demo
```

this runs a live demo of end-to-end shield and unshield operations on sepolia testnet

### Required for Transfer and Unshield

For **transfer** and **unshield** operations (which require proof generation), you must also install the circuit artifacts package:

```sh
pnpm add @railgun-community/circuit-artifacts@https://npm.railgun.org/railgun-community-circuit-artifacts-0.0.1.tgz
```

**Note:** This package is only needed if you plan to use `transfer()` or `unshield()` methods. `shield()` operations do not require proof generation.

## About Forked Libs

code in `src/railgun/lib` was forked 1:1 from [railgun-community/engine](https://github.com/railgun-community/engine) at commit `3ae608337095046d926aabc3cb0eda2f1507cc8d` with a few extremely minor compatibility edits.

conversely, code in `src/railgun/logic` was taken from [railgun-privacy/contract](https://github.com/railgun-privacy/contract) ( the `helpers/` directory) but has been largely reworked.
