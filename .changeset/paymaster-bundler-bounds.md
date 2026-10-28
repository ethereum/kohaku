---
"@kohaku-eth/privacy-pools": patch
"@kohaku-eth/tornado-cash": patch
---

Check paymaster bundler gas prices against the host RPC fee market, bound validation overhead and payload-sized pre-verification gas, and send bundler requests through the host network. Tail-call execution gas can grow with the bundler estimate; optional `maxGasLimits` sets explicit absolute ceilings. There is no percentage-of-withdrawal fee cap. The sponsoring note must still cover the fee. Tornado prepared paymaster payloads include the proof-bound fee and total withdrawn value, with optional fields for compatibility with older saved operations.
