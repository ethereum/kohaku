# ethprivacy/railgun

simplified railgun typescript utils, borrowing code from internals of [railgun-community/engine](https://github.com/railgun-community/engine) and [railgun-privacy/contract](https://github.com/railgun-privacy/contract) (see [here](#about-forked-libs) for more info)

## Demo

create and fill `demo/.env` file similar to `demo/.env.example`

You need a `RPC_URL` (a sepolia RPC e.g. infura) and `TX_SIGNER_KEY` (0x prefixed private key funded with some sepolia ETH)

from monorepo root directory, after installing deps with `pnpm install`, run:

```
pnpm -F @kohaku-eth/railgun demo
```

this runs a live demo of end-to-end shield and unshield operations on sepolia testnet

## About Forked Libs

code in `src/railgun-lib` was forked 1:1 from [railgun-community/engine](https://github.com/railgun-community/engine) at commit `3ae608337095046d926aabc3cb0eda2f1507cc8d` with a few extremely minor compatibility edits.

conversely, code in `src/railgun-logic` was taken from [railgun-privacy/contract](https://github.com/railgun-privacy/contract) ( the `helpers/` directory) but has been largely reworked.
