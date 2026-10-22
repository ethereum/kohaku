---
"@kohaku-eth/privacy-pools": patch
---

Expose `depositor` on `INote`. The field is picked from the underlying deposit event and populated by the note selectors; it is inherited across withdrawals since a note keeps a single depositor for its lifetime (withdrawals only reduce its balance).
