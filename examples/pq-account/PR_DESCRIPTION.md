# feat(examples/pq-account): add in-browser key generation for PQ accounts

## Problem

The example app had no way to generate the two seeds required to deploy a post-quantum smart account. A new developer opening the app for the first time would see empty seed fields with no guidance on how to produce valid values — they had to know the format (`0x` + 64 hex chars), understand that two independent key pairs are needed, and figure out the terminal commands on their own.

This is a significant friction point for an app whose purpose is to onboard developers to post-quantum accounts.

## What Changed

### `src/components/CreateAccountPanel.tsx`
Added a **"Generate New Keys"** button in the Signing Keys section. When clicked it:
- Generates a pre-quantum seed using `ethers.Wallet.createRandom()` (ECDSA secp256k1)
- Generates a post-quantum seed using `ethers.randomBytes(32)` (ML-DSA-44 / CRYSTALS-Dilithium)
- Validates both key pairs derive correctly before setting them
- Auto-fills both seed input fields
- Logs the generated seeds to the console panel with a save reminder

### `generate-keys.mjs` _(new file)_
A standalone CLI script for terminal-based key generation. Useful for scripting, CI, or developers who prefer offline generation before touching the browser.

```bash
cd examples/pq-account
node generate-keys.mjs
```

### `DEPLOY_GUIDE.md` _(new file)_
A complete step-by-step deployment guide covering:
- Prerequisites (Sepolia ETH, Pimlico API key)
- All three key generation methods
- Deploy → Fund → Send transaction flow with expected console output
- Troubleshooting table
- All deployed contract addresses on Sepolia
- Key concepts (why two signatures, gas costs, deterministic addresses)

## Security Considerations

The browser key generation uses `crypto.getRandomValues()` — the same entropy source used by MetaMask and all major Ethereum wallets. The security profile is identical to pasting a manually generated seed: the value is visible in the input field and persisted to `localStorage`. No new attack surface is introduced.

A visible warning in the console reminds users to save their seeds before deploying.

## Why This Is Valuable for the Project

| Before | After |
|--------|-------|
| New developer must know the seed format | Seeds generated with one click |
| Must understand two separate key types | Console explains what was generated |
| No documentation on the full flow | Step-by-step guide included |
| Key generation required terminal knowledge | Fully self-contained in the browser |

The implementation uses only libraries already present in the project (`ethers`, `@noble/post-quantum`) — zero new dependencies.

## Files Changed

```
examples/pq-account/
  src/components/CreateAccountPanel.tsx   ← Generate New Keys button
  generate-keys.mjs                       ← new: CLI key generator
  DEPLOY_GUIDE.md                         ← new: full deployment guide
```

## Testing

1. `cd examples/pq-account && npx vite`
2. Open Create Account tab
3. Click **"Generate New Keys"** — both fields populate, console logs the seeds
4. Click **"Deploy Account"** — account deploys to Sepolia using the generated keys
5. Use the same seeds in Send Transaction — UserOp signs and submits correctly
