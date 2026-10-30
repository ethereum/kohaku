---
"@kohaku-eth/privacy-pools": minor
---

Add an optional `{ sync?: boolean }` (`PPv1ViewOptions`, default `true`) to
`balance()`, `notes()` and `history()`, so integrators can sync once and read
several times without re-syncing. Write methods still always sync.

Fix concurrency issues when calls overlap on the same chain store:
- `sync()` calls no longer overlap on the same store (overlapping syncs could
  append duplicate note secrets or briefly unset the verified ASP root during a
  withdrawal). A call made while a sync is running waits for one follow-up sync,
  shared with the other calls made meanwhile, so it always sees a head read after
  the call;
- concurrent first calls share one store load instead of each building its own;
- `addNoteSecrets` ignores note indexes the record already holds.
