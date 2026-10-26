---
"@kohaku-eth/tornado-cash": patch
---

Pin the Tornado proving artifacts. The prover now checks the circuit JSON and proving key against SHA-256 pins before parsing them, whatever `artifactsLoader` returns, and throws `TornadoArtifactsIntegrityError` on a mismatch. The default loader now fetches from a fixed tornado-cli commit and fails on HTTP errors. The pins are exported as `TORNADO_CIRCUIT_SHA256` and `TORNADO_PROVING_KEY_SHA256`.
