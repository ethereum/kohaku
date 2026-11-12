---
"@kohaku-eth/privacy-pools": patch
---

fix: time out the ASP tree (30 seconds) and the ASP review feed (10 seconds) so a stalled service cannot block syncs (including a ragequit's), and clear cached review statuses when `aspReviewServiceFactory` is removed
