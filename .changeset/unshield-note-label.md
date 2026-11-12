---
"@kohaku-eth/privacy-pools": patch
---

`prepareUnshield` accepts `label` in relayer and paymaster mode to spend one specific note. If that note is missing, belongs to another asset, is not approved, or does not cover the gross amount (fees included with `exact`), preparation throws the new exported `PPv1NoteUnavailableError` (`label`, `reason`, `balance`, `required`) instead of picking another note. `label` cannot be combined with `batch: true`; with `obfuscateAmounts`, the ceiling and change apply to the chosen note alone.

Automatic single-note selection now skips unapproved and empty notes. Before, it could pick an unapproved note smaller than an approved one and fail later while proving.
