import { ethers } from 'ethers';

const ACCOUNT_FACTORY_ABI = [
    "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
    "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address)",
    "function entryPoint() external view returns (address)",
    "function preQuantumLogic() external view returns (address)",
    "function postQuantumLogic() external view returns (address)",
    "function hybridVerifierLogic() external view returns (address)"
];

/**
 * Deploy an ERC4337 account using the PKContract address
 */
export async function deployERC4337Account(
    factoryAddress,
    preQuantumPubKey,
    postQuantumPubKey,
    providerUrl,
    privateKey
) {
    try {
        console.log("\n🏭 Deploying ERC4337 Account...");
        
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        
        const balance = await provider.getBalance(wallet.address);
        console.log("\n💰 Deployer Info:");
        console.log("- Address:", wallet.address);
        console.log("- Balance:", ethers.formatEther(balance), "ETH");
        
        const network = await provider.getNetwork();
        console.log("- Network:", network.name, `(Chain ID: ${network.chainId})`);
        
        // Check factory exists
        console.log("\n🔍 Verifying factory contract...");
        const factoryCode = await provider.getCode(factoryAddress);
        if (factoryCode === '0x') {
            throw new Error("No contract deployed at factory address!");
        }
        console.log("- Factory contract exists ✓");
        
        // Connect to factory
        const factory = new ethers.Contract(factoryAddress, ACCOUNT_FACTORY_ABI, wallet);
        
        // Get factory configuration with error handling
        console.log("\n🔧 Factory Configuration:");
        try {
            const entryPoint = await factory.entryPoint();
            const preQuantumLogic = await factory.preQuantumLogic();
            const postQuantumLogic = await factory.postQuantumLogic();
            const hybridVerifierLogic = await factory.hybridVerifierLogic();
            
            console.log("- EntryPoint:", entryPoint);
            console.log("- Pre-quantum logic:", preQuantumLogic);
            console.log("- Post-quantum logic:", postQuantumLogic);
            console.log("- Hybrid verifier logic:", hybridVerifierLogic);
        } catch (error) {
            console.log("⚠️  Could not read factory configuration:", error.message);
            console.log("This might indicate ABI mismatch. Continuing anyway...");
        }
        
        // Calculate the expected account address
        console.log("\n📍 Calculating expected address...");
        let expectedAddress;
        
        try {
            // Encode the function call manually
            const iface = new ethers.Interface(ACCOUNT_FACTORY_ABI);
            const callData = iface.encodeFunctionData("getAddress", [
                preQuantumPubKey,
                postQuantumPubKey
            ]);
            
            console.log("- Calling getAddress with calldata length:", callData.length);
            
            // Make static call
            const result = await provider.call({
                to: factoryAddress,
                data: callData
            });
            
            console.log("- Raw result:", result);
            
            // Decode result
            expectedAddress = iface.decodeFunctionResult("getAddress", result)[0];
            console.log("- Decoded address:", expectedAddress);
            
        } catch (error) {
            console.error("❌ Failed to calculate address:", error.message);
            
            // If this fails, something is wrong with the contract or ABI
            throw new Error(`Cannot calculate account address: ${error.message}`);
        }
        
        // Sanity check
        if (expectedAddress === factoryAddress) {
            console.log("⚠️  WARNING: Expected address equals factory address!");
            console.log("This suggests the factory's getAddress() is returning address(this)");
            console.log("The factory contract may need to be fixed and redeployed.");
        }
        
        if (!ethers.isAddress(expectedAddress)) {
            throw new Error("Invalid address returned from getAddress()");
        }
        
        console.log("\n📍 Expected account address:", expectedAddress);
        
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
        console.log("\n⛽ Estimating gas...");
        let estimatedGas;
        try {
            estimatedGas = await factory.createAccount.estimateGas(
                preQuantumPubKey,
                postQuantumPubKey
            );
            console.log("- Estimated gas:", estimatedGas.toString());
        } catch (error) {
            console.error("Gas estimation failed:", error.message);
            // Use a default high gas limit
            estimatedGas = 5000000n;
            console.log("- Using default gas limit:", estimatedGas.toString());
        }
        
        const feeData = await provider.getFeeData();
        const gasCostWei = estimatedGas * (feeData.gasPrice || feeData.maxFeePerGas || 0n);
        console.log("- Gas price:", ethers.formatUnits(feeData.gasPrice || feeData.maxFeePerGas || 0n, "gwei"), "gwei");
        console.log("- Estimated cost:", ethers.formatEther(gasCostWei), "ETH");
        
        // Deploy the account
        console.log("\n🚀 Creating ERC4337 account...");
        const tx = await factory.createAccount(
            preQuantumPubKey,
            postQuantumPubKey,
            {
                gasLimit: estimatedGas * 120n / 100n
            }
        );
        
        const txHash = tx.hash;
        console.log("- Transaction hash:", txHash);
        
        // Determine block explorer URL
        let explorerUrl = "";
        if (network.chainId === 1n) {
            explorerUrl = `https://etherscan.io/tx/${txHash}`;
        } else if (network.chainId === 11155111n) {
            explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
        }
        
        if (explorerUrl) {
            console.log("- Block explorer:", explorerUrl);
        }
        
        console.log("- Waiting for confirmation...");
        
        // Wait with polling
        let receipt = null;
        let attempts = 0;
        const maxAttempts = 60;
        
        while (!receipt && attempts < maxAttempts) {
            try {
                receipt = await provider.getTransactionReceipt(txHash);
                if (!receipt) {
                    attempts++;
                    const elapsed = attempts * 5;
                    process.stdout.write(`\r  Waiting... ${elapsed}s elapsed`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (error) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        process.stdout.write('\r                                        \r');
        
        if (!receipt) {
            console.log("\n⚠️  Transaction is taking longer than expected");
            console.log("Check status at:", explorerUrl || txHash);
            return {
                success: false,
                pending: true,
                transactionHash: txHash,
                expectedAddress
            };
        }
        
        if (receipt.status === 0) {
            console.log("\n❌ Transaction failed (reverted)");
            return {
                success: false,
                error: "Transaction reverted",
                transactionHash: txHash
            };
        }
        
        console.log("\n✅ ERC4337 Account created successfully!");
        console.log("- Account address:", expectedAddress);
        console.log("- Block number:", receipt.blockNumber);
        console.log("- Gas used:", receipt.gasUsed.toString());
        
        const actualCost = receipt.gasUsed * (receipt.gasPrice || receipt.effectiveGasPrice || 0n);
        console.log("- Actual cost:", ethers.formatEther(actualCost), "ETH");
        
        // Verify the deployment
        console.log("\n🔍 Verifying deployment...");
        const deployedCode = await provider.getCode(expectedAddress);
        const isDeployed = deployedCode !== '0x';
        console.log("- Account deployed:", isDeployed ? "✓" : "✗");
        
        return {
            success: true,
            address: expectedAddress,
            transactionHash: txHash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            actualCost: ethers.formatEther(actualCost)
        };
        
    } catch (error) {
        console.error("\n❌ Account creation failed:", error.message);
        if (error.stack) {
            console.error("Stack trace:", error.stack);
        }
        return {
            success: false,
            error: error.message
        };
    }
}