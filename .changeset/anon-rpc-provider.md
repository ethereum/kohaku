---
"@kohaku-eth/provider": minor
---

Add anon-rpc provider backend: wraps a hash-pinned, sandboxed anon-rpc worker
(https://github.com/privacy-ethereum/anon-rpc) as an EthereumProvider via a new
`@kohaku-eth/provider/anon` entry point. Browser-only proof of concept.
`waitForTransaction` polls with Tor-sized defaults (4s interval, 5 minute
timeout), configurable through `AnonConfig.waitForTransaction`.
