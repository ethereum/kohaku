---
"@kohaku-eth/tornado-cash": patch
---

Only deposit into known Tornado instances. Pool addresses and denominations read from the RPC are now checked against a static per-chain catalog (`TornadoInstances`, mainnet and Sepolia); pools that are missing from it or disagree with it are ignored on sync and dropped from saved state on load. `protocolConfig.instances` replaces the catalog for a chain, and on a chain with neither `prepareShield` throws.
