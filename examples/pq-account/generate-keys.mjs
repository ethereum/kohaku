/**
 * Kohaku PQ Account — Key Generator
 *
 * Generates the two seeds needed to deploy a post-quantum ERC-4337 smart account.
 * Uses the exact same libraries the example app uses internally.
 *
 * Usage:
 *   cd examples/pq-account
 *   npm install
 *   node generate-keys.mjs
 */

import { ethers } from "ethers";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";

// ── Pre-quantum key (ECDSA secp256k1) ────────────────────────────────────────
const wallet = ethers.Wallet.createRandom();
const preQuantumSeed = wallet.privateKey;

// ── Post-quantum key (ML-DSA-44 / CRYSTALS-Dilithium) ────────────────────────
const postQuantumSeed = ethers.hexlify(ethers.randomBytes(32));
const { publicKey } = ml_dsa44.keygen(ethers.getBytes(postQuantumSeed));

// ── Output ────────────────────────────────────────────────────────────────────
console.log("");
console.log("=".repeat(62));
console.log("  KOHAKU — POST-QUANTUM ACCOUNT KEYS");
console.log("=".repeat(62));
console.log("");
console.log("  PRE-QUANTUM (ECDSA secp256k1)");
console.log("  Seed:    ", preQuantumSeed);
console.log("  Address: ", wallet.address);
console.log("");
console.log("  POST-QUANTUM (ML-DSA-44 / CRYSTALS-Dilithium)");
console.log("  Seed:    ", postQuantumSeed);
console.log("  PubKey:  ", publicKey.length, "bytes — stored onchain as PKContract");
console.log("");
console.log("=".repeat(62));
console.log("  ⚠️  SAVE BOTH SEEDS IN A PASSWORD MANAGER.");
console.log("  Lose them = lose the account. No recovery possible.");
console.log("=".repeat(62));
console.log("");
