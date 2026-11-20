---
"@kohaku-eth/tornado-cash": patch
---

The opt-in execution-gas retry (`executionGasRetry`) now increases gas only for a bundler JSON-RPC rejection with the ERC-7769 execution-phase code (`-32521`) whose message says the execution ran out of gas. Before, matching words in any error text, including other error codes, transport errors or plain errors, could trigger a more expensive retry.
