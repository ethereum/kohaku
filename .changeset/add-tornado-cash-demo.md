---
"@kohaku-eth/tornado-cash": patch
---

Add minimal `demo/simple.ts` script referenced by the `pnpm demo` package script.
The script derives a deposit commitment from a mnemonic and encodes the
corresponding deposit transaction for the 0.1 ETH mainnet pool (no network
calls, no broadcast). Drop `rootDir` from tsconfig so `pnpm check` covers the
`demo` directory already listed in `include`.
