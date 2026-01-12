import { ethers } from 'ethers';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { to_expanded_encoded_bytes } from './utils_mldsa.js';

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    if (hex.length !== 64) {
        throw new Error("Seed must be 32 bytes (64 hex chars)");
    }
    return Uint8Array.from(
        hex.match(/.{2}/g).map(b => parseInt(b, 16))
    );
}

/**
 * Validate hex seed input
 */
function validateSeed(seed, name) {
    if (!seed.startsWith("0x")) {
        throw new Error(`${name} must start with "0x"`);
    }
    if (seed.length !== 66) { // 0x + 64 hex chars
        throw new Error(`${name} must be 32 bytes (66 characters including 0x, got ${seed.length})`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) {
        throw new Error(`${name} contains invalid hex characters`);
    }
}

/**
 * Detect and connect to available wallet (browser only)
 */
async function detectAndConnectWallet() {
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error(
            "No wallet detected. Please install MetaMask, Rabby, or another Ethereum wallet.\n" +
            "Download:\n" +
            "  - MetaMask: https://metamask.io/\n" +
            "  - Rabby: https://rabby.io/"
        );
    }
    
    // Check for Rabby (Rabby injects first and sets a flag)
    if (window.ethereum.isRabby) {
        console.log("🦊 Rabby wallet detected");
    } else if (window.ethereum.isMetaMask) {
        console.log("🦊 MetaMask detected");
    } else {
        console.log("🔌 Ethereum wallet detected");
    }
    
    console.log("🔌 Connecting to wallet...");
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    
    return window.ethereum;
}

async function main() {
    // Read configuration from input fields
    const factoryAddress = document.getElementById('factory').value.trim();
    const prequantum_seed = document.getElementById('prequantum').value.trim();
    const postquantum_seed = document.getElementById('postquantum').value.trim();
    
    console.log("🔧 Configuration:");
    console.log("- Factory Address: " + factoryAddress);
    console.log("");
    
    // Validate seeds
    try {
        validateSeed(prequantum_seed, "Pre-quantum seed");
        validateSeed(postquantum_seed, "Post-quantum seed");
    } catch (error) {
        console.error("❌ Invalid seed: " + error.message);
        return;
    }
    
    // Detect and connect to wallet
    let signer;
    try {
        const walletProvider = await detectAndConnectWallet();
        const provider = new ethers.BrowserProvider(walletProvider);
        signer = await provider.getSigner();
        
        const address = await signer.getAddress();
        const balance = await provider.getBalance(address);
        
        console.log("✅ Wallet connected");
        console.log("- Address: " + address);
        console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
        
        const network = await provider.getNetwork();
        console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
        console.log("");
        
    } catch (error) {
        console.error("❌ " + error.message);
        return;
    }
    
    // Generate pre-quantum public key
    console.log("🔑 Generating keys...");
    const preQuantumPubKey = new ethers.Wallet(prequantum_seed).address;
    console.log("- Pre-quantum public key: " + preQuantumPubKey);
    
    // Generate post-quantum public key
    const { publicKey } = ml_dsa44.keygen(hexToU8(postquantum_seed));
    const postQuantumPubKey = to_expanded_encoded_bytes(publicKey);
    console.log("- Post-quantum public key: " + ethers.hexlify(postQuantumPubKey).slice(0, 20) + "...");
    console.log("");
    
    // Import the deploy function dynamically
    const { deployERC4337Account } = await import('./accountDeploy.js');
    
    // Deploy ERC4337 Account
    console.log("📦 Deploying ERC4337 Account...");
    const accountResult = await deployERC4337Account(
        factoryAddress,
        preQuantumPubKey,
        postQuantumPubKey,
        signer
    );
    
    if (accountResult.success) {
        console.log("");
        console.log("============================================================");
        console.log("🎉 DEPLOYMENT COMPLETE!");
        console.log("============================================================");
        console.log("📍 ERC4337 Account: " + accountResult.address);
        if (accountResult.transactionHash) {
            console.log("📝 Transaction Hash: " + accountResult.transactionHash);
        }
        if (accountResult.alreadyExists) {
            console.log("ℹ️  Note: Account already existed at this address");
        }
        console.log("============================================================");
    } else {
        console.error("❌ Deployment failed");
        if (accountResult.error) {
            console.error("Error: " + accountResult.error);
        }
    }
}

// Setup UI - THIS RUNS ONCE WHEN PAGE LOADS
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('deploy');
    const output = document.getElementById('output');
    
    if (!button || !output) {
        console.error('Missing UI elements');
        return;
    }
    
    // Redirect console.log to the output div (DO THIS ONLY ONCE)
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = function(...args) {
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        
        output.textContent += message + '\n';
        output.scrollTop = output.scrollHeight;
        originalLog.apply(console, args);
    };
    
    console.error = function(...args) {
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        
        output.textContent += '❌ ' + message + '\n';
        output.scrollTop = output.scrollHeight;
        originalError.apply(console, args);
    };
    
    // Check for wallet on load
    if (typeof window !== 'undefined' && window.ethereum) {
        output.textContent = '✅ Wallet detected. Configure seeds above and click deploy.\n';
    } else {
        output.textContent = '⚠️ No wallet detected. Please install MetaMask or Rabby.\n';
    }
    
    // Button click handler
    button.addEventListener('click', async () => {
        button.disabled = true;
        output.textContent = ''; // Clear previous output
        
        try {
            await main();
        } catch (error) {
            console.error('Error: ' + error.message);
        } finally {
            button.disabled = false;
        }
    });
});