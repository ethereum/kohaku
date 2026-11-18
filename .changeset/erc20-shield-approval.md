---
"@kohaku-eth/privacy-pools": patch
"@kohaku-eth/tornado-cash": patch
---

Privacy Pools ERC-20 shields now include the approval. `prepareShield` returned only the Entrypoint deposit, which reverts without a prior allowance, so a wallet sending the returned `txns` as-is could not shield ERC-20 tokens. The plan is now `approve(entrypoint, amount)` followed by the deposit. Native deposits are unchanged.

For tokens whose `approve` reverts when changing one nonzero allowance to another (mainnet USDT), both packages first reset the allowance to zero. A leftover allowance, for example from a deposit that reverted after its approval, no longer blocks the next shield.

Custom Privacy Pools state managers: `getDepositPayload` now returns `TxData[]`, the shield plan in order, instead of a single `TxData`.
