---
"@kohaku-eth/tornado-cash": patch
---

Cap what the bundler can charge on paymaster withdrawals. Its gas price must stay within 3x the host provider's latest base fee plus a tip cap (the larger of 2 gwei and 3x `eth_maxPriorityFeePerGas`), each gas limit from its estimate within 2x the plugin's baseline, and the fee within the new `maxFeeBPS` option (default `DEFAULT_PAYMASTER_MAX_FEE_BPS`, 10% of the withdrawn amount); otherwise `prepareUnshield` throws before anything is proved, signed, or sent to the bundler. Paymaster withdrawals now report the proof-bound `fee` and `withdrawnValue`, and bundler JSON-RPC (including from the state worker) goes through `host.network.fetch`.
