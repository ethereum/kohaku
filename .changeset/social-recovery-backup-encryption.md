---
"@kohaku-eth/social-recovery": patch
---

Add the backup encryption: `sealBackup` and `openBackup` (PBKDF2-HMAC-SHA256 at 600,000 iterations, AES-256-GCM with the caller's 96-bit nonce and the five authenticated values as associated data, one fixed padding size), the configuration's serialization and the backup payload version constant.
