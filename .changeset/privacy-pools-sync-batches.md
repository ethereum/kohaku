---
"@kohaku-eth/privacy-pools": patch
---

Scan and register pool events in batches of four instead of fetching and retaining every pool's results at once. Build event arrays with loops instead of spreading large arrays into function arguments. A failed batch still fails the sync without advancing its cursor; completed batches are pruned and replayed on retry as before.

This limits concurrent pool scans and temporary cross-pool results; the size of an individual pool's response is unchanged.
