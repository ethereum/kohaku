import { ethers } from 'ethers';

const ACCOUNT_FACTORY_ABI = [
    "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
    "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address payable)",
    "function entryPoint() external view returns (address)",
    "function preQuantumLogic() external view returns (address)",
    "function postQuantumLogic() external view returns (address)",
    "function hybridVerifierLogic() external view returns (address)"
];

/**
 * Deploy an ERC4337 account using an external signer
 * Works with MetaMask, Rabby, Ledger (via browser), and any ethers.js Signer
 */
export async function deployERC4337Account(
    factoryAddress,
    preQuantumPubKey,
    postQuantumPubKey,
    signerOrProvider
) {
    try {
        console.log("");
        console.log("🏭 Deploying ERC4337 Account...");
        
        // Get provider and signer
        let provider, signer;
        
      if (typeof signerOrProvider === "string") {
            // signerOrProvider is a JSON-RPC URL
            provider = new ethers.JsonRpcProvider(signerOrProvider);
            if (privateKey) {
                signer = new ethers.Wallet(privateKey, provider);
            } else if (provider.getSigner) {
                signer = provider.getSigner();
            }
            console.log("🔌 Connected via RPC URL:", signerOrProvider);

        } else if (signerOrProvider.signTransaction) {
            // Already a Signer
            signer = signerOrProvider;
            provider = signer.provider;
            console.log("🔌 Using provided Signer");

        } else if (signerOrProvider.request) {
            // Browser wallet (MetaMask, Rabby, Ledger)
            console.log("🔌 Connecting to browser wallet...");
            provider = new ethers.BrowserProvider(signerOrProvider);
            signer = await provider.getSigner();
            console.log("✅ Wallet connected");

        } else if (signerOrProvider.getNetwork) {
            // Already a Provider
            provider = signerOrProvider;
            signer = await provider.getSigner();
            console.log("🔌 Using provided Provider");

        } else {
            throw new Error(
                "Invalid signer or provider. Please provide window.ethereum, a Signer, a Provider, or an RPC URL string."
            );
        }

        const address = await signer.getAddress();
        const balance = await provider.getBalance(address);
        
        console.log("");
        console.log("💰 Deployer Info:");
        console.log("- Address: " + address);
        console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
        
        const network = await provider.getNetwork();
        console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
        
        // Check factory exists
        console.log("");
        console.log("🔍 Verifying factory contract...");
        const factoryCode = await provider.getCode(factoryAddress);
        if (factoryCode === '0x') {
            throw new Error("No contract deployed at factory address!");
        }
        console.log("- Factory contract exists ✓");
        
        // Connect to the existing factory contract (already deployed on-chain)
        const factory = new ethers.Contract(factoryAddress, ACCOUNT_FACTORY_ABI, signer);
                
        // Calculate the expected account address
        console.log("");
        console.log("📍 Calculating expected address...");
        let expectedAddress;
        
        try {
            const iface = new ethers.Interface(ACCOUNT_FACTORY_ABI);
            const callData = iface.encodeFunctionData("getAddress", [
                preQuantumPubKey,
                postQuantumPubKey
            ]);
            
            console.log("- Calling getAddress...");
            
            const result = await provider.call({
                to: factoryAddress,
                data: callData
            });
            
            expectedAddress = iface.decodeFunctionResult("getAddress", result)[0];
            console.log("- Calculated address: " + expectedAddress);
            
        } catch (error) {
            console.error("❌ Failed to calculate address: " + error.message);
            throw new Error("Cannot calculate account address: " + error.message);
        }
 
        if (!ethers.isAddress(expectedAddress)) {
            throw new Error("Invalid address returned from getAddress()");
        }
        
        console.log("");
        console.log("📍 Expected account address: " + expectedAddress);
        
        // Check if account already exists
        const code = await provider.getCode(expectedAddress);
        if (code !== '0x') {
            console.log("✅ Account already exists at this address!");
            return {
                success: true,
                address: expectedAddress,
                alreadyExists: true
            };
        }
        
        // Estimate gas
        console.log("");
        console.log("⛽ Estimating gas...");
        let estimatedGas;
        try {
            estimatedGas = await factory.createAccount.estimateGas(
                preQuantumPubKey,
                postQuantumPubKey
            );
            console.log("- Estimated gas: " + estimatedGas.toString());
        } catch (error) {
            console.error("⚠️  Gas estimation failed: " + error.message);
            estimatedGas = 5000000n;
            console.log("- Using default gas limit: " + estimatedGas.toString());
        }
        
        const feeData = await provider.getFeeData();
        const gasCostWei = estimatedGas * (feeData.gasPrice || feeData.maxFeePerGas || 0n);
        console.log("- Gas price: " + ethers.formatUnits(feeData.gasPrice || feeData.maxFeePerGas || 0n, "gwei") + " gwei");
        console.log("- Estimated cost: " + ethers.formatEther(gasCostWei) + " ETH");
        
        // Deploy the account
        console.log("");
        console.log("🚀 Creating ERC4337 account...");
        console.log("⏳ Please confirm the transaction in your wallet...");
        
        const tx = await factory.createAccount(
            preQuantumPubKey,
            postQuantumPubKey,
            {
                gasLimit: estimatedGas * 120n / 100n
            }
        );
        
        const txHash = tx.hash;
        console.log("✅ Transaction signed!");
        console.log("- Transaction hash: " + txHash);
        
        // Determine block explorer URL
        let explorerUrl = "";
        if (network.chainId === 1n) {
            explorerUrl = "https://etherscan.io/tx/" + txHash;
        } else if (network.chainId === 11155111n) {
            explorerUrl = "https://sepolia.etherscan.io/tx/" + txHash;
        }
        else if (network.chainId === 421614n) {
            explorerUrl = "https://sepolia.arbiscan.io/tx/" + txHash;
        }
        
        if (explorerUrl) {
            console.log("- Block explorer: " + explorerUrl);
        }
        
        console.log("- Waiting for confirmation...");
        
        // Wait for receipt (browser-compatible way)
        let receipt = null;
        let attempts = 0;
        const maxAttempts = 60;
        
        while (!receipt && attempts < maxAttempts) {
            try {
                receipt = await provider.getTransactionReceipt(txHash);
                if (!receipt) {
                    attempts++;
                    const elapsed = attempts * 5;
                    console.log("  ⏳ Waiting... " + elapsed + "s elapsed");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (error) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        if (!receipt) {
            console.log("");
            console.log("⚠️  Transaction is taking longer than expected");
            console.log("Check status at: " + (explorerUrl || txHash));
            return {
                success: false,
                pending: true,
                transactionHash: txHash,
                expectedAddress
            };
        }
        
        if (receipt.status === 0) {
            console.log("");
            console.log("❌ Transaction failed (reverted)");
            return {
                success: false,
                error: "Transaction reverted",
                transactionHash: txHash
            };
        }
        
        console.log("");
        console.log("✅ ERC4337 Account created successfully!");
        console.log("- Account address: " + expectedAddress);
        console.log("- Block number: " + receipt.blockNumber);
        console.log("- Gas used: " + receipt.gasUsed.toString());
        
        const actualCost = receipt.gasUsed * (receipt.gasPrice || receipt.effectiveGasPrice || 0n);
        console.log("- Actual cost: " + ethers.formatEther(actualCost) + " ETH");
        
        // Verify the deployment
        console.log("");
        console.log("🔍 Verifying deployment...");
        const deployedCode = await provider.getCode(expectedAddress);
        const isDeployed = deployedCode !== '0x';
        console.log("- Account deployed: " + (isDeployed ? "✓" : "✗"));
        
        return {
            success: true,
            address: expectedAddress,
            transactionHash: txHash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            actualCost: ethers.formatEther(actualCost)
        };
        
    } catch (error) {
        console.log("");
        console.error("❌ Account creation failed: " + error.message);
        if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
            console.log("(User rejected the transaction in wallet)");
        }
        return {
            success: false,
            error: error.message
        };
    }
}
