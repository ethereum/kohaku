<p align="center">
<a href="https://ethereum.github.io/kohaku/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ethereum/kohaku/refs/heads/master/docs/public/kohaku_logo.svg">
<img alt="Kohaku logo" src="https://raw.githubusercontent.com/ethereum/kohaku/refs/heads/master/docs/public/kohaku_logo.svg" width="auto" height="60">
</picture>
</a>
</p>

<p align="center">
<a href="https://github.com/ethereum/kohaku/actions"><img src="https://img.shields.io/badge/Tests-passing-green" align="center" /></a>
<img src="https://img.shields.io/badge/Packages-2-blue" align="center" />
</p>

Privacy-first tooling for the Ethereum ecosystem

> [!IMPORTANT]
> Some parts of this project are work in progress and NOT READY FOR PRODUCTION USE. Packages contain UNAUDITED CODE. Consult underlying package READMEs for more detailed information.

## Repository Structure

| Package                                             | Status | Description                                  |
| ----------------------------------------------------| ------ | -------------------------------------------- |
| [@kohaku-eth/railgun](crates/railgun-ts)             | ✅     | railgun shielded pool protocol lib                 |
| [@kohaku-eth/tornado-cash](packages/tornado-cash) | ✅     | tornado cash shielded pool protocol lib           |
| [@kohaku-eth/privacy-pools](packages/privacy-pools) | ✅     | privacy pools shielded pool protocol lib           |
| [@kohaku-eth/plugins](packages/plugins) | ✅     | shielded pool protocols standardized plugin interface          |
| [@kohaku-eth/provider](packages/provider)           | ✅     | provider abstraction (ethers, viem, helios, colibri) |
| [@kohaku-eth/pq-account](packages/pq-account)       | ✅     | post-quantum 4337 account implementation     |

## Development

Navigate to the README in each package in `packages/` for package specific details.

In general, easiest way to have a stable dev environment is to use nix. [Install Nix here](https://nixos.org/download/)

then run:

```shell
nix develop --extra-experimental-features "nix-command flakes" --command $SHELL
```

fill your `.env` file in the root dir manually (with the vars in `.env.sample`) OR get a maintainer to register a sops key for you, so you can decrypt env secrets directly.

### Building

`@kohaku-eth/privacy-pools` depends on `@0xbow-io/privacy-pools-v2-sdk`, which is only
published to GitHub Packages — a registry that requires authentication even for reads.
The SDK is declared as an optional dependency, so `pnpm install` succeeds without
credentials (the SDK is simply skipped), and the default build excludes the package:

| Command                     | Scope                                            | GitHub token |
| --------------------------- | ------------------------------------------------ | ------------ |
| `pnpm build`                | every package except `@kohaku-eth/privacy-pools` | not needed   |
| `pnpm build:privacy-pools`  | only `@kohaku-eth/privacy-pools`                 | required     |
| `pnpm build:all`            | everything                                       | required     |

To work on `packages/privacy-pools`, see the token setup in its
[README](packages/privacy-pools/README.md#development).
