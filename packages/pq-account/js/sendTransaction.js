import { ethers } from 'ethers';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import {
    createUserOperation,
    signUserOpHybrid,
    submitUserOperation,
    ENTRY_POINT_ADDRESS
} from './userOperation.js';

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

/**
 * Send a transaction from your ERC4337 account
 */
export async function sendERC4337Transaction(
    accountAddress,
    targetAddress,
    value,
    callData,
    preQuantumSeed,
    postQuantumSeed,
    provider,
    bundlerUrl
) {
    try {
        console.log("🚀 Sending ERC4337 Transaction...");
        console.log("");
        
        // Get network info
        const network = await provider.getNetwork();
        
        console.log("📋 Transaction Details:");
        console.log("- From (Account): " + accountAddress);
        console.log("- To: " + targetAddress);
        console.log("- Value: " + ethers.formatEther(value) + " ETH");
        console.log("- Call Data: " + callData);
        console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
        console.log("");
        
        const blockNumber = await provider.getBlockNumber();
        console.log("Block number:", blockNumber);
        
        // Check account balance
        const accountBalance = await provider.getBalance(accountAddress);
        console.log("💰 Account Balance: " + ethers.formatEther(accountBalance) + " ETH");
        
        if (accountBalance === 0n) {
            console.log("⚠️  WARNING: Account has no balance!");
            console.log("You need to send ETH to: " + accountAddress);
            console.log("");
        }
        
        // Generate private keys from seeds
        console.log("🔑 Generating keys from seeds...");
        const preQuantumWallet = new ethers.Wallet(preQuantumSeed);
        
        // Generate FULL ML-DSA keypair from seed (this gives us the 2560-byte secret key)
        const { secretKey, publicKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed));
        
        // Create UserOperation
        const userOp = await createUserOperation(
            accountAddress,
            targetAddress,
            value,
            callData,
            provider,
            bundlerUrl
        );
        
        // Sign UserOperation with hybrid signature
        const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
        
        // Pass the FULL secret key (2560 bytes), not the seed!
        const signature = await signUserOpHybrid(
            userOp,
            ENTRY_POINT,
            network.chainId,
            preQuantumSeed,      // Pre-quantum: 32-byte seed is fine
            secretKey            // Post-quantum: must be 2560-byte secret key!
        );
        
        userOp.signature = signature;
        
        console.log("");
        console.log("=".repeat(60));
        console.log("📦 Complete UserOperation Created");
        console.log("=".repeat(60));
        console.log("Sender: " + userOp.sender);
        console.log("Nonce: " + userOp.nonce.toString());
        console.log("Signature length: " + userOp.signature.length + " chars");
        console.log("=".repeat(60));
        console.log("");
        
        // Check if bundler URL is provided
        if (!bundlerUrl || bundlerUrl.trim() === '' || bundlerUrl.includes('example.com')) {
            console.log("ℹ️  No valid bundler URL provided");
            console.log("");
            console.log("✅ UserOperation created and signed successfully!");
            console.log("");
            console.log("To submit this UserOperation:");
            console.log("1. Get a bundler service:");
            console.log("   - Alchemy: https://www.alchemy.com/");
            console.log("   - Pimlico: https://www.pimlico.io/");
            console.log("   - Stackup: https://www.stackup.sh/");
            console.log("2. Update the bundler URL in the form");
            console.log("3. Click the button again to submit");
            console.log("");
             console.log("📄 UserOperation Preview:");
            console.log(JSON.stringify({
                sender: userOp.sender ?? "<undefined>",
                nonce: '0x' + ((userOp.nonce ?? 0).toString(16)),
                callGasLimit: '0x' + ((userOp.callGasLimit ?? 0).toString(16)),
                verificationGasLimit: '0x' + ((userOp.verificationGasLimit ?? 0).toString(16)),
                preVerificationGas: '0x' + ((userOp.preVerificationGas ?? 0).toString(16)),
                maxFeePerGas: '0x' + ((userOp.maxFeePerGas ?? 0).toString(16)),
                maxPriorityFeePerGas: '0x' + ((userOp.maxPriorityFeePerGas ?? 0).toString(16)),
                callData: userOp.callData ? userOp.callData.slice(0, 50) + '... (length: ' + userOp.callData.length + ')' : "<undefined>",
                signature: userOp.signature ? userOp.signature.slice(0, 50) + '... (length: ' + userOp.signature.length + ')' : "<undefined>"
                }, null, 2));

            return {
                success: true,
                userOp: userOp,
                message: "UserOperation created and signed (bundler needed to submit)"
            };
        }

        // Submit to bundler
        try {
            const userOpHash = await submitUserOperation(userOp, bundlerUrl, ENTRY_POINT);
            
            console.log("");
            console.log("=".repeat(60));
            console.log("🎉 TRANSACTION SUBMITTED!");
            console.log("=".repeat(60));
            console.log("UserOp Hash: " + userOpHash);
            console.log("=".repeat(60));
            
            return {
                success: true,
                userOpHash: userOpHash
            };
            
        } catch (error) {
            console.error("❌ Failed to submit to bundler: " + error.message);
            console.log("");
            console.log("The UserOperation was created and signed correctly,");
            console.log("but submission to the bundler failed.");
            console.log("Please check your bundler URL and try again.");
            
            return {
                success: false,
                error: error.message,
                userOp: userOp
            };
        }
        
    } catch (error) {
        console.error("");
        console.error("❌ Transaction failed: " + error.message);
        if (error.stack) {
            console.log("");
            console.log("Stack trace:");
            console.log(error.stack);
        }
        return {
            success: false,
            error: error.message
        };
    }
}

// Setup UI when page loads
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('sendTx');
    const output = document.getElementById('output');
    
    if (!button || !output) {
        console.error('Missing UI elements');
        return;
    }
    
    // Redirect console.log to the output div
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
    
    // Initial message
    output.textContent = '✅ Ready to create and sign UserOperation.\nConnect your wallet and fill in the details above.\n';
    
    // Button click handler
    button.addEventListener('click', async () => {
        button.disabled = true;
        output.textContent = '';
        
        try {
            // Check for wallet
            if (!window.ethereum) {
                console.log('❌ No wallet detected!');
                console.log('Please install MetaMask or Rabby wallet.');
                return;
            }
            
            // Connect to wallet
            console.log('🔌 Connecting to wallet...');
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            
            // Create provider from wallet
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const signerAddress = await signer.getAddress();
            
            console.log('✅ Wallet connected: ' + signerAddress);
            console.log("");
            
            // Get input values
            const accountAddress = document.getElementById('accountAddress').value.trim();
            const targetAddress = document.getElementById('targetAddress').value.trim();
            const valueEth = document.getElementById('value').value.trim();
            const callData = document.getElementById('callData').value.trim();
            const preQuantumSeed = document.getElementById('preQuantumSeed').value.trim();
            const postQuantumSeed = document.getElementById('postQuantumSeed').value.trim();
            const bundlerUrl = document.getElementById('bundlerUrl')?.value.trim() || "";
            
            // Parse value
            const value = ethers.parseEther(valueEth);
            
            // Send transaction
            await sendERC4337Transaction(
                accountAddress,
                targetAddress,
                value,
                callData,
                preQuantumSeed,
                postQuantumSeed,
                provider,
                bundlerUrl
            );
            
        } catch (error) {
            console.error('Error: ' + error.message);
        } finally {
            button.disabled = false;
        }
    });
});