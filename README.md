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
