---
"@kohaku-eth/tornado-cash": patch
---

Validate saved Tornado Cash state and initial snapshots before use, including tuple shapes, numeric fields, imported secrets and deposit indices. Invalid state produces a recovery error without deleting or overwriting the original. Keep older optional snapshot fields compatible and serialize negative bigints in a readable decimal form.

Restart pools with impossible saved cursors from a verified deployment boundary. Valid stored cursors remain trusted coverage claims; hosts can opt into a clean resync for suspected missing history while preserving imported notes.
