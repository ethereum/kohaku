import { ethers } from 'ethers';
import { to_expanded_encoded_bytes } from './utils_mldsa.js';
import * as softEcdsaKeygen from './software-signer/ecdsaKeygen.js';
import * as softMldsaKeygen from './software-signer/mldsaKeygen.js';
import * as hwEcdsaKeygen from './hardware-signer/ecdsaKeygen.js';
import * as hwMldsaKeygen from './hardware-signer/mldsaKeygen.js';

/**
 * Validate hex seed input
 */
function validateSeed(seed, name) {
    if (!seed.startsWith("0x")) {
        throw new Error(`${name} must start with "0x"`);
    }
    if (seed.length !== 66) {
        throw new Error(`${name} must be 32 bytes (66 characters including 0x, got ${seed.length})`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) {
        throw new Error(`${name} contains invalid hex characters`);
    }
}

async function main(mode) {
    const factoryAddress = document.getElementById('factory').textContent.trim();
    if (!factoryAddress || factoryAddress === '—') {
        console.error("❌ No factory address found for this network.");
        return;
    }

    // 1. Connect browser wallet
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error(
            "No wallet detected. Please install MetaMask, Rabby, or another Ethereum wallet.\n" +
            "Download:\n" +
            "  - MetaMask: https://metamask.io/\n" +
            "  - Rabby: https://rabby.io/"
        );
    }

    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    const address = await signer.getAddress();
    const balance = await provider.getBalance(address);
    const network = await provider.getNetwork();

    console.log("✅ Wallet connected");
    console.log("- Address: " + address);
    console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
    console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
    console.log("");

    // 2. Get keys based on mode
    let preQuantumPubKey, mldsaPublicKey;

    if (mode === 'ledger') {
        preQuantumPubKey = await hwEcdsaKeygen.getAddress();
        console.log("");
        mldsaPublicKey = await hwMldsaKeygen.getPublicKey();
    } else {
        const preQuantumSeed = document.getElementById('prequantum').value.trim();
        const postQuantumSeed = document.getElementById('postquantum').value.trim();

        try {
            validateSeed(preQuantumSeed, "Pre-quantum seed");
            validateSeed(postQuantumSeed, "Post-quantum seed");
        } catch (error) {
            console.error("❌ Invalid seed: " + error.message);
            return;
        }

        preQuantumPubKey = await softEcdsaKeygen.getAddress({ privateKey: preQuantumSeed });
        mldsaPublicKey = await softMldsaKeygen.getPublicKey({ postQuantumSeed });
    }

    // 3. Encode keys for the contract
    const postQuantumPubKey = to_expanded_encoded_bytes(mldsaPublicKey);

    // 4. Deploy
    console.log("");
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

// ─── UI Setup ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const deployBtn = document.getElementById('deploy');
    const deployLedgerBtn = document.getElementById('deploy-ledger');
    const output = document.getElementById('output');

    if (!output) {
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

    // Check for wallet on load
    if (typeof window !== 'undefined' && window.ethereum) {
        output.textContent = '✅ Wallet detected. Configure seeds above and click deploy.\n';
    } else {
        output.textContent = '⚠️ No wallet detected. Please install MetaMask or Rabby.\n';
    }

    async function run(mode) {
        const btn = mode === 'ledger' ? deployLedgerBtn : deployBtn;
        if (btn) btn.disabled = true;
        output.textContent = '';

        try {
            await main(mode);
        } catch (error) {
            console.error('Error: ' + error.message);
            if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
                console.log("(User rejected the transaction in wallet)");
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    if (deployBtn) deployBtn.addEventListener('click', () => run('soft'));
    if (deployLedgerBtn) deployLedgerBtn.addEventListener('click', () => run('ledger'));
});

// ─── Factory ABI ────────────────────────────────────────────────────────

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
 */
export async function deployERC4337Account(
    factoryAddress,
    preQuantumPubKey,
    postQuantumPubKey,
    signerOrProvider
) {
    try {
        let provider, signer;

        if (typeof signerOrProvider === "string") {
            provider = new ethers.JsonRpcProvider(signerOrProvider);
            if (provider.getSigner) {
                signer = provider.getSigner();
            }
            console.log("🔌 Connected via RPC URL:", signerOrProvider);

        } else if (signerOrProvider.signTransaction) {
            signer = signerOrProvider;
            provider = signer.provider;

        } else if (signerOrProvider.request) {
            console.log("🔌 Connecting to browser wallet...");
            provider = new ethers.BrowserProvider(signerOrProvider);
            signer = await provider.getSigner();
            console.log("✅ Wallet connected");

        } else if (signerOrProvider.getNetwork) {
            provider = signerOrProvider;
            signer = await provider.getSigner();
            console.log("🔌 Using provided Provider");

        } else {
            throw new Error(
                "Invalid signer or provider. Please provide window.ethereum, a Signer, a Provider, or an RPC URL string."
            );
        }

        const address = await signer.getAddress();
        const network = await provider.getNetwork();

        const factoryCode = await provider.getCode(factoryAddress);
        if (factoryCode === '0x') {
            throw new Error("No contract deployed at factory address!");
        }

        const factory = new ethers.Contract(factoryAddress, ACCOUNT_FACTORY_ABI, signer);

        let expectedAddress;
        try {
            const iface = new ethers.Interface(ACCOUNT_FACTORY_ABI);
            const callData = iface.encodeFunctionData("getAddress", [
                preQuantumPubKey,
                postQuantumPubKey
            ]);
            const result = await provider.call({
                to: factoryAddress,
                data: callData
            });
            expectedAddress = iface.decodeFunctionResult("getAddress", result)[0];
        } catch (error) {
            console.error("❌ Failed to calculate address: " + error.message);
            throw new Error("Cannot calculate account address: " + error.message);
        }

        if (!ethers.isAddress(expectedAddress)) {
            throw new Error("Invalid address returned from getAddress()");
        }

        const code = await provider.getCode(expectedAddress);
        if (code !== '0x') {
            return {
                success: true,
                address: expectedAddress,
                alreadyExists: true
            };
        }

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

        console.log("");
        console.log("🚀 Creating ERC4337 account...");
        console.log("⏳ Please confirm the transaction in your wallet...");

        const tx = await factory.createAccount(
            preQuantumPubKey,
            postQuantumPubKey,
            { gasLimit: estimatedGas * 120n / 100n }
        );

        const txHash = tx.hash;
        console.log("✅ Transaction signed!");
        console.log("- Transaction hash: " + txHash);

        let explorerUrl = "";
        if (network.chainId === 1n) {
            explorerUrl = "https://etherscan.io/tx/" + txHash;
        } else if (network.chainId === 11155111n) {
            explorerUrl = "https://sepolia.etherscan.io/tx/" + txHash;
        } else if (network.chainId === 421614n) {
            explorerUrl = "https://sepolia.arbiscan.io/tx/" + txHash;
        }

        if (explorerUrl) {
            console.log("- Block explorer: " + explorerUrl);
        }

        console.log("- Waiting for confirmation...");

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