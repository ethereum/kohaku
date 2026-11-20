# Kohaku SDK — Agent Guide

Kohaku is a TypeScript/Solidity monorepo SDK providing post-quantum ERC-4337 smart accounts, privacy pools, and RAILGUN integration on Ethereum.

## Project Structure

| Package | Purpose |
|---------|---------|
| `packages/pq-account` | Post-quantum ERC-4337 accounts (Falcon, MLDSA). Foundry project. |
| `packages/privacy-pools` | Privacy pool integration |
| `packages/railgun` | RAILGUN private tx SDK (browser + Node bundles) |
| `packages/provider` | Ethereum provider wrapper (`@kohaku-eth/provider`) |
| `packages/plugins` | Plugin system |
| `examples/pq-account` | React/Vite/Wagmi demo app for deploying PQ accounts |
| `docs/` | Documentation site |

**Tooling:** Foundry for Solidity, TypeScript/pnpm for SDK packages.

---

## Codebase Deep Dive — Post-Quantum Accounts

### Architecture

```
examples/pq-account (React + Vite + Wagmi)
  ├── utils/createAccount.ts     → derive pubkeys from seeds, call factory
  ├── utils/userOperation.ts     → build + sign + submit UserOps (hybrid signing)
  ├── utils/sendTransaction.ts   → orchestrate full send flow
  ├── utils/utils_mldsa.ts       → ML-DSA key encoding helpers
  ├── config/wagmi.ts            → chain config (Sepolia only wired), imports deployments.json
  └── components/
      ├── CreateAccountPanel.tsx → deploy account UI (hardcoded: mldsa_k1 mode)
      ├── SendTransactionPanel.tsx
      └── AavePanel.tsx          → Aave DeFi integration

packages/pq-account (Foundry)
  ├── src/ZKNOX_ERC4337_account.sol  → smart account with bilateral sig verification
  ├── src/ZKNOX_PQFactory.sol        → CREATE2 factory
  ├── script/DeployFixedContracts.s.sol → deploy verifier contracts
  ├── script/DeployFactories.s.sol   → deploy factory contracts
  ├── script/deploy_fixed_contracts.sh / deploy_factories.sh
  ├── deployments/deployments.json   → all deployed addresses
  └── test/                          → Foundry tests for all 8 signature combos
```

### How a PQ Account Works (end-to-end)

**Step 1 — Key generation (browser, no chain needed)**
- Pre-quantum: `new ethers.Wallet(preQuantumSeed).address` → secp256k1 ECDSA address
- Post-quantum: `ml_dsa44.keygen(postQuantumSeed)` → ML-DSA-44 key pair

**Step 2 — Deploy (one tx via factory)**
- `ZKNOX_PQFactory.createAccount(preQPubKey, postQPubKey)` → deploys via CREATE2
- Address is fully deterministic: `salt = keccak256(preQPubKey, postQPubKey, VERSION)`
- Idempotent: already-deployed returns existing address, no second deploy

**Step 3 — Sign every tx with BOTH signatures**
```typescript
userOpHash = keccak256(packedUserOp, entryPoint, chainId)
preQuantumSig  = ecdsa.sign(userOpHash, secp256k1PrivKey)
postQuantumSig = ml_dsa44.sign(userOpHash, mldsaSecretKey)
hybridSig = abi.encode(["bytes","bytes"], [preQuantumSig, postQuantumSig])
```
Both must verify independently onchain — either failure reverts the tx.

**Step 4 — Submit via ERC-4337 bundler (Pimlico)**
- EntryPoint: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- Bundler: Pimlico (`https://api.pimlico.io/v2/{chainId}/rpc?apikey=...`)
- Gas: `verificationGasLimit` minimum is **13,500,000** (ML-DSA onchain verification is expensive)

### Signature Schemes & Deployed Contracts

**Fixed verifier contracts (deployed once, shared by all users):**

| Scheme | Sepolia Address |
|--------|----------------|
| MLDSA | `0x1C789898a6141Fd5F840334Bb2E289fB188a3cb6` |
| MLDSAETH | `0xbfF02B9D0EB96f1Fe1BeB57817F0d6085813f1c0` |
| FALCON | `0x82DDb9783D5577853CbAf2a02b359beeA1E4c4B9` |
| ETHFALCON | `0x01880eb770be007aE75febabA21532Fb5c33318B` |
| ECDSA K1 | `0xCE4a6283fCf156B61170D438CC89bA0e96693043` |
| ECDSA R1 | `0xDB5F45915EbD4647874d5ffFd31a331eE4554c27` |

**Factory contracts on Sepolia (one per mode combo):**

| Mode | Factory Address | Pre-Q | Post-Q |
|------|----------------|-------|--------|
| `mldsa_k1` | `0xe28F039653772C32b0eDB1db7c7A5FA250DDA0e5` | K1 | MLDSA |
| `mldsa_r1` | `0x01Ff8790a7615Db192ca1005fe60d0732f432eF5` | R1 | MLDSA |
| `mldsaeth_k1` | `0x053116Dae2F3F966B2957D11f87A8Ff298ae31C2` | K1 | MLDSAETH |
| `mldsaeth_r1` | `0x3b68f42a9eAfDF85D64492Cc68d5C88d1a525c05` | R1 | MLDSAETH |
| `falcon_k1` | `0x43D1B09AC488ea1CF2De674Adb3cB97fa0A51c00` | K1 | FALCON |
| `falcon_r1` | `0x9984bc6D728991Df5C5662B865b7024a11909999` | R1 | FALCON |
| `ethfalcon_k1` | `0x75de9AF9902978826bc99E48f468b682bE17F416` | K1 | ETHFALCON |
| `ethfalcon_r1` | `0x93115df4f05728Effe3845B552Be5Ff8f183a908` | R1 | ETHFALCON |

**On Arbitrum Sepolia:** Only `mldsa_k1` is deployed (same address as Sepolia).

### Key Quirks & Gotchas

- **MLDSA public keys are ~20kB** — too large for calldata. For MLDSA modes, the pubkey is stored in a separate `PKContract` onchain. Falcon pubkeys fit inline.
- **UI is hardcoded to `mldsa_k1`** (`CreateAccountPanel.tsx` line 74). Changing mode requires code change.
- **Arbitrum Sepolia NOT in wagmi config** — `wagmi.ts` only has `sepolia`. Arb Sepolia is in deployments.json but needs to be added to chains.
- **Verification gas is huge** — `verificationGasLimit: 13_500_000` minimum (onchain dilithium is expensive). This is why Arbitrum Sepolia is recommended (cheaper gas).
- **Seeds are deterministic** — same seed always produces same account address. There's no randomness.
- **Pimlico bundler required** for tx submission — no bundler URL = signed UserOp returned but not submitted.

### Running the Example App

```bash
cd examples/pq-account
npm install
npx vite   # → http://localhost:5173
```

**Requirements:** MetaMask/Rabby on Sepolia, Sepolia ETH, Pimlico API key from dashboard.pimlico.io

### Running Contract Tests (Foundry)

```bash
cd packages/pq-account
make install     # installs Solidity + Python deps (Python signer used in tests)
make test_opt    # runs all tests
# or individually:
forge test test/ZKNOX_ERC4337_account_K1_MLDSA.t.sol -vv
```

**Note:** Falcon key generation in Python is slow — tests take longer for Falcon variants.

### Deploying Contracts

```bash
cd packages/pq-account/script
./deploy_fixed_contracts.sh <private_key> <abi_key> <contract_name>
./deploy_factories.sh <private_key> <abi_key> <contract_name>
```
Contract names come from `DeployFixedContracts.s.sol` / `DeployFactories.s.sol`.

---

---

# ETH Skills (ethskills.com — verified March 2026)

> Say **"onchain"** not "on-chain". One word, no hyphen.

## Current Ethereum Facts — Do Not Use Stale Training Data

- **Gas:** Under 1 gwei base fee. ETH transfer ~$0.004, swap ~$0.04, ERC-20 deploy ~$0.24. Run `cast base-fee` to verify.
- **ETH price:** ~$2,000 (volatile — always verify live).
- **Upgrades shipped:** Pectra (May 2025), Fusaka (Dec 2025). EIP-7702 is LIVE.
- **ERC-4337:** Early-stage. Major implementations: Kernel, Biconomy, Alchemy Account Kit.
- **Celo:** NOT an L1 — migrated to OP Stack L2 March 2025.
- **Polygon zkEVM:** Being shut down. Do not build on it.
- **Base left Superchain:** February 2026.
- **Unichain:** Launched mainnet February 11, 2025. TEE-based MEV protection.
- **Aerodrome + Velodrome:** Merged into "Aero" (November 2025).
- **Dominant DEX per L2:** NOT Uniswap — Aero (Base/Optimism), Camelot (Arbitrum).

---

## Security Rules (CRITICAL)

- **USDC = 6 decimals, not 18.** This is the #1 "where did my money go?" bug.
- **Always use SafeERC20** — USDT doesn't return bool on `transfer()`.
- **Checks-Effects-Interactions pattern** + `ReentrancyGuard` on all external calls.
- **Never use DEX spot prices as oracles** — flash loans can manipulate in one tx. Use Chainlink with staleness checks, or 30+ min TWAP.
- **Never `type(uint256).max` approvals** — use bounded amounts.
- **Proxies:** Use UUPS, not Transparent. Never change storage layout (append-only). Use `initializer` not constructor.
- **EIP-712:** Use for all typed signature verification — domain separation + replay protection.
- **Delegatecall:** Never delegatecall untrusted addresses — executes in your storage context.
- **MEV:** Use Flashbots Protect or explicit slippage limits.
- **NEVER commit private keys or API keys to Git.** Bots exploit in seconds. If a key leaks: transfer funds immediately, key is permanently burned.

### Pre-Deploy Checklist
- [ ] Access control on all state-changing functions
- [ ] ReentrancyGuard on external calls
- [ ] Decimal handling (don't assume 18)
- [ ] Oracle safety (Chainlink + staleness)
- [ ] SafeERC20 usage
- [ ] Bounded approvals
- [ ] Input validation at all boundaries
- [ ] Events emitted for all state changes
- [ ] Run Slither/Mythril
- [ ] Fuzz + edge-case tests pass
- [ ] Fork tests against real protocols pass

---

## Testing (Foundry)

Test what matters: **edge cases, failure modes, economic invariants** — the things that lose money when they break.

| Type | When to use |
|------|-------------|
| **Unit** | Custom logic, edge cases (zero, max), access control, failure modes |
| **Fuzz** | All math — run 1000+ iterations. Finds bugs you didn't think of. |
| **Fork** | Any external protocol integration (avoids mock/prod divergence) |
| **Invariant** | Stateful protocols — vaults, AMMs, lending. Thousands of random call sequences. |

**Skip:** OpenZeppelin internals, language features, trivial getters, happy-path-only.

---

## Standards

### EIP-7702 (LIVE May 2025)
EOAs can delegate smart-contract code without migration. Enables batching, gas sponsorship, session keys. Relevant to post-quantum account design — users may prefer EIP-7702 delegation over full ERC-4337 deployments.

### ERC-4337 (Account Abstraction)
Smart contract wallets with bundlers. Major impls: Kernel, Biconomy, Alchemy Account Kit. Still early-stage infrastructure.

### ERC-8004 — Agent Identity Registry (Live Jan 29, 2026)
Deployed at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on 20+ chains. NFT-based onchain identity for AI agents with service endpoints, reputation, and validation registries.

### x402 — HTTP Payment Protocol (Production Q1 2026)
Coinbase standard using HTTP 402 for machine-to-machine micropayments. Client signs EIP-3009 auth; server settles onchain. USDC implements EIP-3009.

### EIP-3009 — Gasless Token Transfers
Signed authorizations for token transfers. USDC implements it. Powers x402.

---

## Onchain Mental Models (Concepts)

- **Smart contracts cannot execute themselves.** Every function needs a caller who pays gas. No timers, no cron jobs, no schedulers.
- **For every state transition ask:** Who calls it? Why would they? What if nobody does?
- **Design with incentives** — successful protocols (Uniswap, Aave) let strangers perform critical functions via profit motive alone.
- **Onchain = ownership, trustless exchanges, permanent commitments.** NOT user profiles, search, or frequently-changing logic.
- **Most dApps need 0–2 contracts.** Three is the upper bound for an MVP.
- **CROPS framework:** Censorship Resistance, Open Source, Privacy, Security — check all four.
- **Randomness:** Never use `block.timestamp` or `blockhash` for randomness. Use commit-reveal or Chainlink VRF.

---

## Safe Multisig (Production Treasury)

Deterministic addresses v1.4.1 (same across all chains):
- Safe Singleton: `0x41675C099F32341bf84BFc5382aF534df5C7461a`
- Safe Proxy Factory: `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`
- MultiSend: `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526`

Recommended for AI agents: 2-of-3 multisig (agent hot wallet + human hot wallet + human cold recovery).

---

## Tools & Infrastructure

- **Foundry** is the default (not Hardhat) — 10–100x faster tests, native Solidity testing.
- **Blockscout MCP:** `https://mcp.blockscout.com/mcp` — structured blockchain data for agents via MCP.
- **abi.ninja:** Paste any verified contract address, call all functions, zero setup.
- **RPC providers:** Alchemy, Infura, QuickNode (paid); LlamaNodes, Ankr (free).
- **Testnet:** Sepolia (Goerli and Rinkeby are deprecated).
- **Agent workflow:** Blockscout MCP for reads → `cast` / viem for writes → abi.ninja for exploration → `anvil` for local fork testing.

---

## L2 Deployment Notes

| L2 | Best for | Key fact |
|----|----------|----------|
| Base | Consumer apps, AI agents, Coinbase on-ramp | 50% cheaper than Arb/OP. Left Superchain Feb 2026. |
| Arbitrum | Deep DeFi liquidity (GMX, Pendle, Camelot) | Stylus: Rust/C → WASM, 10-100x gas savings for compute |
| Optimism | OP Stack ecosystem, retroPGF | Standard OP Stack tooling |
| zkSync Era | Native AA (no bundlers) | Requires `zksolc` compiler |
| Unichain | MEV transparency, DeFi | TEE-based time-ordered blocks |

**Cross-chain deployments:** Use CREATE2 with identical salt + bytecode for deterministic addresses across chains.

**Optimistic rollup timing:** Never use `block.number` for timing logic — use `block.timestamp`.

---

## Audit Approach

When reviewing contracts:
1. **Reentrancy** — check all external calls follow CEI
2. **Access control** — every state-changing fn explicitly restricted
3. **Math** — multiply before divide, no floating point, fuzz all operations
4. **Oracle safety** — no spot prices, Chainlink + staleness
5. **Token quirks** — check decimals dynamically, use SafeERC20
6. **Signature replay** — EIP-712 domain separation, nonce tracking
7. **Proxy storage** — layout append-only, initializer pattern
8. **Delegatecall** — only to trusted, audited addresses
9. **Incentive design** — every function has a motivated caller
10. **MEV exposure** — slippage, frontrunning, sandwich vectors

---

*Skills sourced from https://ethskills.com — verified March 2026. Fetch individual skill pages for deep dives.*
