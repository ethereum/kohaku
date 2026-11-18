---
"@kohaku-eth/tornado-cash": patch
---

Validate relayer destinations before status and withdrawal requests. Require DNS hostnames and HTTPS root URLs, reject authority and path injection, and disable redirects. Validation also covers destinations restored from snapshots or supplied in prepared operations.
