---
"@kohaku-eth/privacy-pools": patch
---

fix: time out the ASP tree (30 seconds) and the ASP review feed (10 seconds) so a stalled service cannot block syncs (including a ragequit's), and stop showing cached review statuses to accounts without `aspReviewServiceFactory`
