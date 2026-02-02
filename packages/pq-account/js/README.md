# ZKNOX — Quantum-Resistant ERC4337 Accounts

A web interface for deploying and managing post-quantum secure Ethereum accounts using the ERC4337 standard.

## Overview

ZKNOX enables the creation of hybrid signature accounts combining:
- **ML-DSA-44** (CRYSTALS-Dilithium) — Post-quantum lattice-based signatures
- **ECDSA secp256k1** — Classical Ethereum signatures

This dual-signature scheme provides quantum resistance while maintaining compatibility with existing Ethereum infrastructure.

## Features

- 🔐 **Create Account** — Deploy a new ERC4337 quantum-resistant smart account
- 📤 **Send Transaction** — Sign and submit UserOperations with hybrid signatures
- 🌐 **Multi-network** — Supports Ethereum, Sepolia, Arbitrum Sepolia
- 🎨 **Modern UI** — Dark theme interface with real-time wallet status

## Installation

```bash
npm init -y
npm install ethers @noble/hashes @noble/post-quantum vite
npx vite
```

Then open your browser at the localhost URL displayed (usually `http://localhost:5173`).

## Project Structure

```
├── zknox-app.html        # Main application interface
├── createAccount.js      # Account deployment logic
├── sendTransaction.js    # Transaction signing & submission
├── userOperation.js      # ERC4337 UserOperation utilities
├── utils_mldsa.js        # ML-DSA key encoding utilities
├── zknox-logo.png        # ZKNOX logo
├── koi-logo.png          # Mascot logo
└── deployments/
    └── deployments.json  # Factory contract addresses per network
```

## Usage

### 1. Create an Account

1. Connect your wallet (MetaMask, Rabby, etc.)
2. Enter your pre-quantum seed (ECDSA) and post-quantum seed (ML-DSA)
3. Click **"Connect Wallet & Deploy Account"**
4. Confirm the transaction in your wallet

> ⚠️ **Security Note**: Use test seeds only. Never use production seeds on a public website.

### 2. Send a Transaction

1. Get a free API key from [Pimlico Dashboard](https://dashboard.pimlico.io)
2. Enter your Pimlico API key
3. Fill in your ERC4337 account address and recipient
4. Enter the same seeds used to create the account
5. Click **"Sign & Submit UserOperation"**

## Requirements

- Node.js 18+
- A Web3 wallet (MetaMask, Rabby, etc.)
- ETH on the target network for gas fees
- [Pimlico API key](https://dashboard.pimlico.io) for transaction submission

## Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Arbitrum Sepolia | 421614 | ✅ Recommended |
| Sepolia | 11155111 | ✅ Supported |
| Ethereum | 1 | 🔜 Coming soon |

> **Note**: Arbitrum Sepolia is recommended due to lower gas costs for signature verification.

## Dependencies

- [ethers.js](https://docs.ethers.org/) — Ethereum library
- [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum) — ML-DSA implementation
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) — Cryptographic hash functions
- [Vite](https://vitejs.dev/) — Development server

## Links

- Website: [zknox.com](https://zknox.com)
- Pimlico Bundler: [dashboard.pimlico.io](https://dashboard.pimlico.io)

## License

MIT License — See [LICENSE](LICENSE) for details.
