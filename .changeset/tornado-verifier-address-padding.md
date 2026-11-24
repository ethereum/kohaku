---
"@kohaku-eth/tornado-cash": patch
---

Preserve leading zeros in pool addresses when reading their verifiers for paymaster gas estimation. Withdrawals involving a leading-zero pool, including Sepolia's 0.01 ETH pool, no longer fail with an RPC `Invalid params` error. This applies to both single-note and batched withdrawals.
