---
"@kohaku-eth/railgun": patch
---

Feat: Switch remote artifact loading to use brotli compressed files, and update remote file structure
Feat: Enable logging in railgun plugin by default, with option to disable it
Fix: Pending POIs were not saved under certain conditions
Fix: Switch POI query to check spendability status rather than merkle trie inclusion for better accuracy