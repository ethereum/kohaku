---
"@kohaku-eth/tornado-cash": patch
---

Verify each pool's synced deposits before storing them. A sync rebuilds the pool's Merkle tree and requires gapless leaf indices, the pool's on-chain leaf count and its exact root at the scanned head. On a mismatch nothing is stored and the cursor does not move. Events from the external sync provider are retried from the chain alone, and a chain scan that still fails replays the pool from deployment. Each pool saves its tree frontier at the finalized block, so a sync hashes only the deposits it scanned again, and a withdrawal checks the pool's last verified root instead of rebuilding the tree. The separate `verify` sync option is removed, since every sync now verifies.

Track a finalized cursor per pool and rescan everything after it on each sync, dropping deposits and withdrawals a reorg removed. Pools saved before this are rewound 7,200 blocks once. The RPC must support the `finalized` block tag.
