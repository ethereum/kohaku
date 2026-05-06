# Deploying Your First Post-Quantum Smart Account

A step-by-step guide to create and use a quantum-resistant ERC-4337 smart account using ML-DSA-44 + ECDSA hybrid signatures on Sepolia testnet.

---

## How It Works (Quick Overview)

```
Your seeds
   ├─ Pre-quantum seed  ──► ECDSA private key ──► Ethereum address (public key)
   └─ Post-quantum seed ──► ML-DSA-44 key pair ──► expanded pubkey stored onchain

Factory.createAccount(ecdsaAddress, mldsaPubKey)
   └─► CREATE2 deploys your smart account at a deterministic address

Every transaction requires BOTH signatures:
   sig = abi.encode( ecdsa.sign(hash), mldsa.sign(hash) )
   Bundler → EntryPoint → your smart account → execute
```

**Two separate roles:**

| | Connected Wallet (MetaMask) | Seeds |
|--|---------------------------|-------|
| Purpose | Pays gas for factory deployment | Controls the smart account |
| Relationship | Like a landlord handing keys | The actual keys to the apartment |
| Stored | In MetaMask | In app localStorage + you save them |
| Reuse? | Yes, your regular wallet | Generate fresh ones per account |

> Your MetaMask wallet and the seeds are completely independent. MetaMask only pays for the deployment transaction — it has no ongoing control over the smart account.

---

## Prerequisites

### 1. Get Sepolia ETH

Your connected wallet needs ETH on **Sepolia testnet** to pay for the factory deployment.

Free faucets:
- https://sepoliafaucet.com
- https://faucet.quicknode.com/ethereum/sepolia
- https://faucets.chain.link/sepolia

Aim for at least **0.05 ETH** (factory deploy + funding the new account).

### 2. Get a Pimlico API Key

Pimlico is the bundler that submits your UserOperations to the network.

1. Go to https://dashboard.pimlico.io
2. Create a free account
3. Create an API key — it looks like `pim_xxxxxxxxxxxxxxxx`

### 3. Switch MetaMask/Rabby to Sepolia

Make sure your wallet is on **Sepolia testnet** before opening the app.

---

## Step 1 — Start the App

```bash
cd examples/pq-account
npm install
npx vite
```

Open http://localhost:5173 and connect your wallet.

---

## Step 2 — Generate Your Seeds

Seeds are 32-byte hex values that deterministically derive your account's key pairs. **Same seeds always produce the same account address.**

### Understanding what seeds produce

```
Pre-quantum seed  (32 bytes)
  └─► ethers.Wallet(seed).address        ← ECDSA secp256k1 private key
      The Ethereum address becomes your pre-quantum public key onchain.

Post-quantum seed  (32 bytes)
  └─► ml_dsa44.keygen(seed)
      ├─ publicKey  (~1312 bytes, expanded to ~20kB for onchain storage)
      └─ secretKey  (used to sign every transaction)
```

The seed is just a random starting point. Both full key pairs are re-derived from it on every signature — you only ever need to store the seed.

---

### Option A — Generate Keys button in the UI (recommended)

The app has a **"Generate New Keys"** button in the Create Account tab. Click it and both seed fields are filled automatically. The console panel shows the generated seeds with a reminder to save them.

Under the hood it runs the exact same logic as the Kohaku SDK:
```
ethers.Wallet.createRandom()       → pre-quantum seed (ECDSA)
ethers.randomBytes(32)             → post-quantum seed (ML-DSA-44)
ml_dsa44.keygen(postQuantumSeed)   → validates derivation works
```

Browser entropy source: `crypto.getRandomValues()` — the same used by MetaMask.

---

### Option B — Kohaku SDK CLI script

A standalone script `generate-keys.mjs` is included in the example app root. Run it from the terminal:

```bash
cd examples/pq-account
npm install
node generate-keys.mjs
```

Output:
```
══════════════════════════════════════════════════════════════
  KOHAKU — POST-QUANTUM ACCOUNT KEYS
══════════════════════════════════════════════════════════════

  PRE-QUANTUM (ECDSA secp256k1)
  Seed:     0xabc...
  Address:  0x123...

  POST-QUANTUM (ML-DSA-44 / CRYSTALS-Dilithium)
  Seed:     0xdef...
  PubKey:   1312 bytes — stored onchain as PKContract

══════════════════════════════════════════════════════════════
  ⚠️  SAVE BOTH SEEDS IN A PASSWORD MANAGER.
  Lose them = lose the account. No recovery possible.
══════════════════════════════════════════════════════════════
```

Useful for scripting, CI environments, or when you prefer the terminal.

---

### Option C — Quick terminal one-liner (for testing only)

```bash
node -e "console.log('Pre-quantum seed: ', '0x' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('Post-quantum seed:', '0x' + require('crypto').randomBytes(32).toString('hex'))"
```

Uses Node's built-in crypto. No dependencies needed, but gives you raw random bytes without showing the derived public keys.

---

### Option D — App defaults (testnet only)

The app pre-fills:
```
Pre-quantum seed:  0x0000000000000000000000000000000000000000000000000000000000000001
Post-quantum seed: 0x0000000000000000000000000000000000000000000000000000000000000001
```

Fine for a quick first test on Sepolia. **Never use on mainnet or with real funds.**

---

**Rules for all options:**
- Seeds must be `0x` followed by exactly 64 hex characters (32 bytes)
- Do NOT use your MetaMask private key as a seed — seeds are stored in browser localStorage
- Save both seeds in a password manager before funding the account
- Lose the seeds = lose the account. There is no recovery.

---

## Step 3 — Deploy the Account

1. Open the **Create Account** tab
2. Enter your Pre-Quantum Seed (ECDSA) and Post-Quantum Seed (ML-DSA-44)
3. Click **"Deploy Account"**
4. Confirm the transaction in MetaMask/Rabby

The console will show:

```
Connecting to wallet...
  Address: 0xYourWallet...
  Balance: 0.05 ETH
  Network: sepolia (Chain ID: 11155111)

Deploying ERC4337 Account...
  Expected account address: 0xYourNewAccount...

Estimating gas...
  Estimated: 4200000
  Estimated cost: 0.00042 ETH

Creating account...
Please confirm in your wallet...

Transaction signed! Hash: 0x...
Waiting for confirmation...

DEPLOYMENT COMPLETE!
ERC4337 Account: 0xYourNewAccount...
Transaction: 0x...
Gas used: 4100000
Actual cost: 0.00041 ETH
```

**Copy and save the ERC4337 Account address.**

> If you see "ACCOUNT ALREADY EXISTS" — that's expected. Same seeds always produce the same address. Your account is already deployed and ready.

---

## Step 4 — Fund the Account

Your smart account starts with 0 ETH. It needs ETH to pay for UserOperation gas.

In the **Fund Account** section:
1. The account address is auto-filled
2. Set amount to `0.01` ETH
3. Click **"Send ETH"**
4. Confirm in your wallet

This sends ETH from your connected wallet to the smart account.

---

## Step 5 — Send a Transaction

Go to the **Send Transaction** tab and fill in:

| Field | What to enter |
|-------|--------------|
| ERC4337 Account Address | Your account address from Step 3 (auto-filled) |
| Pimlico API Key | Your key from dashboard.pimlico.io |
| Recipient Address | Any address to send to |
| Amount | `0.0001` ETH |
| Pre-Quantum Seed | Same seed used in Step 2 |
| Post-Quantum Seed | Same seed used in Step 2 |

Click **"Sign & Submit Transaction"**.

The console will show:

```
Transaction Details:
  From: 0xYourAccount...
  To: 0xRecipient...
  Value: 0.0001 ETH

Creating UserOperation...
Signing with hybrid scheme...
  ├─ ECDSA signature (pre-quantum)
  └─ ML-DSA-44 signature (post-quantum)

Estimating gas...
Submitting to bundler...

TRANSACTION SUBMITTED!
UserOp hash: 0x...
```

---

## Step 6 — Verify Your Transaction

UserOps are **not regular transactions** — they won't show up if you search the hash on Etherscan directly. You need a UserOp-aware explorer.

### Why Etherscan won't work

Pimlico bundles your UserOp with others and submits them as a **single regular transaction** from the bundler's address. Etherscan shows the bundler's tx, not your specific UserOp inside it.

### Where to verify

**Jiffyscan** (recommended)
```
https://jiffyscan.xyz
```
Paste your UserOp hash → select **Sepolia** → you'll see:
- Status: `success` or `failed`
- Your smart account as sender
- The actual ETH transfer
- Gas breakdown: ~13.5M for ML-DSA verification + execution gas
- The Pimlico bundler that submitted it

**ERC4337 Scan**
```
https://www.erc4337.io/userops
```

**Blockscout Sepolia** (also UserOp aware)
```
https://eth-sepolia.blockscout.com
```

> **Note:** UserOps take 30 sec – 2 min to appear onchain. The bundler batches multiple ops before submitting. If you don't see it immediately, wait and refresh.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "No contract at factory address" | Wrong network | Switch wallet to Sepolia |
| Transaction reverts | Account has no ETH | Fund the account (Step 4) first |
| "Gas estimation failed" | Expected on first run | App falls back to 5M gas limit — still works |
| Bundler submission fails | Bad API key or wrong network | Check Pimlico key is for Sepolia |
| App shows wrong factory address | Network mismatch | Connect wallet to Sepolia |
| Seeds rejected | Wrong format | Must be exactly `0x` + 64 hex chars |

---

## Deployed Contract Addresses (Sepolia)

The verifier and factory contracts are already deployed — you don't need to deploy them yourself.

### Verifiers (shared by all users)

| Scheme | Address |
|--------|---------|
| MLDSA | `0x1C789898a6141Fd5F840334Bb2E289fB188a3cb6` |
| MLDSAETH | `0xbfF02B9D0EB96f1Fe1BeB57817F0d6085813f1c0` |
| FALCON | `0x82DDb9783D5577853CbAf2a02b359beeA1E4c4B9` |
| ETHFALCON | `0x01880eb770be007aE75febabA21532Fb5c33318B` |
| ECDSA K1 | `0xCE4a6283fCf156B61170D438CC89bA0e96693043` |
| ECDSA R1 | `0xDB5F45915EbD4647874d5ffFd31a331eE4554c27` |

### Factories (this app uses `mldsa_k1`)

| Mode | Factory Address |
|------|----------------|
| `mldsa_k1` | `0xe28F039653772C32b0eDB1db7c7A5FA250DDA0e5` |
| `mldsa_r1` | `0x01Ff8790a7615Db192ca1005fe60d0732f432eF5` |
| `falcon_k1` | `0x43D1B09AC488ea1CF2De674Adb3cB97fa0A51c00` |
| `falcon_r1` | `0x9984bc6D728991Df5C5662B865b7024a11909999` |
| `ethfalcon_k1` | `0x75de9AF9902978826bc99E48f468b682bE17F416` |
| `ethfalcon_r1` | `0x93115df4f05728Effe3845B552Be5Ff8f183a908` |

> Full address list: `packages/pq-account/deployments/deployments.json`

---

## Key Concepts

**Why two signatures?**
ECDSA is vulnerable to quantum computers (Shor's algorithm can break it). ML-DSA-44 (CRYSTALS-Dilithium) is NIST-standardized post-quantum safe. By requiring both, the account is secure against both classical and quantum attackers — if quantum computers break ECDSA in the future, ML-DSA still protects the account.

**Why is verification gas so high (~13.5M)?**
ML-DSA signature verification runs entirely onchain in Solidity. The math is complex — that's the cost of quantum resistance today. Arbitrum Sepolia is cheaper for testing this.

**Why are addresses deterministic?**
The factory uses CREATE2 with a salt derived from your two public keys. This means you can predict your account address before deploying, and re-derive it from seeds at any time.

**What if I lose my seeds?**
There is no recovery. The seeds ARE the account. Back them up in a password manager before funding the account with real value.
