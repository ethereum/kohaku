---
"@kohaku-eth/tornado-cash": patch
---

Reject oversized worker-to-host call envelopes before traversing or copying their argument arrays. Current host calls accept at most two top-level arguments. Bound path depth and metadata strings, and avoid coercing malformed path elements when reporting refusals. These checks apply after message delivery and do not prevent structured-clone costs or message flooding.
