---
"@kohaku-eth/privacy-pools": patch
---

Sync now reads one chain head, scans the entrypoint and every pool up to it, and saves that head as the next sync point. Before, each scan read its own head and the last pool-event block was saved, so entrypoint deposits that landed between the two heads were skipped forever and the note dropped out of the balance. A failed pool scan now fails the sync instead of being skipped, the saga log source starts its RPC tail right after the block it served (it skipped blocks under a `headBlock` clamp), and custom `IDataService` implementations need a `getBlockNumber()` method.
