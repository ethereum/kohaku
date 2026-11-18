---
"@kohaku-eth/tornado-cash": patch
---

Verify a pool's initial scan block before persisting it: the external provider's first covered block is only used when the pool has no code in the block before it, the on-chain deployment search rejects malformed `eth_getCode` responses and undeployed addresses, and an empty log range no longer advances the sync cursor. Event syncs now backfill from the chain any blocks before the provider's first covered block, and report the chain tail's actual cursor instead of the initial head.
