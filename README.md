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
> Some parts of this project are work in progress and not ready for production use.

## Repository Structure

| Package                                             | Status | Description                                  |
| ----------------------------------------------------| ------ | -------------------------------------------- |
| [@kohaku-eth/railgun](packages/railgun)             | ✅     | railgun privacy protocol lib                 |
| [@kohaku-eth/privacy-pools](packages/privacy-pools) | ✅     | privacy pools privacy protocol lib           |
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
