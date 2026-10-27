---
"@kohaku-eth/social-recovery": patch
---

Take the digest `place` as the full `uint256` the `PolicyManager` hashes, so a place beyond 2^53 has a typed data and a digest.

Breaking: the `place` of the `ApprovalMessage` and `CancellationMessage` records, and so of `ApprovalTypedData`, `CancellationTypedData` and a `Ctx`'s typed data, is a `bigint`. `approvalTypedData`, `cancellationTypedData`, `approvalDigest` and `cancellationDigest` accept `place: number | bigint`: a number must be a non-negative safe integer, a bigint must fit `uint256`, and anything else throws a `TypeError` or `RangeError` as before.
