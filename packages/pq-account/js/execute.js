import { ethers } from 'ethers';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { to_expanded_encoded_bytes } from './utils_mldsa.js';
import { deployERC4337Account } from './accountDeploy.js';

function hexToU8(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length !== 64) {
    throw new Error("Seed must be 32 bytes (64 hex chars)");
  }
  return Uint8Array.from(
    hex.match(/.{2}/g).map(b => parseInt(b, 16))
  );
}

async function main() {
    const privateKey = process.argv[2];
    const providerUrl = "https://eth-sepolia-testnet.api.pocket.network";
    const factoryAddress = "0x82af6d1f821b1032fDfdEAa2247008d97999309f";
    
    // seeds
    const prequantum_seed = "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
    const postquantum_seed = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    
    // prequantum pubkey
    const preQuantumPubKey = new ethers.Wallet(prequantum_seed).address;
    
    // postquantum pubkey
    const { _, publicKey } = ml_dsa44.keygen(hexToU8(postquantum_seed));
    const postQuantumPubKey = to_expanded_encoded_bytes(publicKey);

    // Step 3: Deploy ERC4337 Account
    console.log("Deploying ERC4337 Account...");
    const accountResult = await deployERC4337Account(
        factoryAddress,
        preQuantumPubKey,
        postQuantumPubKey,
        providerUrl,
        privateKey
    );
    
    if (accountResult.success) {
        console.log("\n" + "=".repeat(60));
        console.log("🎉 FULL DEPLOYMENT COMPLETE!");
        console.log("=".repeat(60));
        console.log("📍 ERC4337 Account:", accountResult.address);
        console.log("=".repeat(60));
    } else {
        console.error("❌ Account deployment failed");
        process.exit(1);
    }
}

main().catch(console.error);