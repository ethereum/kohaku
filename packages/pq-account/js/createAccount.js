import { ethers } from 'ethers';
import { to_expanded_encoded_bytes } from './utils_mldsa.js';
import * as softEcdsaKeygen from './software-signer/ecdsaKeygen.js';
import * as softMldsaKeygen from './software-signer/mldsaKeygen.js';
import * as softFalconKeygen from './software-signer/falconKeygen.js';
import {
    openTransport,
    deriveMldsaSeed,
    getMldsaPublicKey,
    getEcdsaPublicKey,
} from './hardware-signer/ledgerTransport.js';
import { LedgerEthSigner } from './LedgerEthSigner.js';

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

/**
 * Pack 512 NTT coefficients (each ≤ 16 bits) into 32 uint256 words,
 * matching _ZKNOX_NTT_Compact in Solidity.
 *
 * @param {BigInt[]|number[]} coeffs - 512 coefficients
 * @returns {BigInt[]} 32 packed uint256 words
 */
function nttCompact(coeffs) {
    if (coeffs.length !== 512) throw new Error("Expected 512 coefficients, got " + coeffs.length);

    const b = new Array(32).fill(0n);

    for (let i = 0; i < 512; i++) {
        const wordIndex = i >> 4;          // i / 16
        const bitShift = (i & 0xf) * 16; // (i % 16) * 16
        b[wordIndex] ^= BigInt(coeffs[i]) << BigInt(bitShift);
    }

    return b;
}

/**
 * Encode the Falcon-512 public key for the on-chain verifier.
 */
function toFalconEncodedBytes(falconPublicKey) {
    // Falcon-512 public key: 1 byte header + 512 × 2 bytes (16-bit coefficients)
    if (falconPublicKey.length !== 1025) {
        throw new Error("Expected 1025-byte Falcon-512 public key, got " + falconPublicKey.length);
    }

    // Extract 512 coefficients (16-bit big-endian, matching WASM modq_encode16) skipping the 1-byte header
    const coeffs = [];
    for (let i = 0; i < 512; i++) {
        const offset = 1 + i * 2;
        coeffs.push((falconPublicKey[offset] << 8) | falconPublicKey[offset + 1]);
    }

    // Pack 512 coeffs → 32 uint256 words (matches _ZKNOX_NTT_Compact)
    const packed = nttCompact(coeffs);

    // Raw 1024 bytes — no ABI offset/length header
    let hex = "0x";
    for (const word of packed) {
        hex += word.toString(16).padStart(64, "0");
    }
    return hex;
}

async function main(mode) {
    const factoryAddress = document.getElementById('factory').textContent.trim();
    if (!factoryAddress || factoryAddress === '\u2014') {
        console.error("\u274C No factory address found for this network.");
        return;
    }

    const accountMode = document.getElementById('accountMode')?.value || 'mldsa_k1';
    const pqAlgo = accountMode.startsWith('falcon') ? 'falcon' : 'mldsa';

    let provider, signer, transport;

    try {
        if (mode === 'ledger') {
            if (pqAlgo === 'falcon') {
                console.error("\u274C Falcon is only available in software mode.");
                return;
            }

            // ── Ledger mode: RPC provider + Ledger-backed signer ──────────
            const rpcUrl = document.getElementById('rpcUrl')?.value.trim();
            if (!rpcUrl) {
                console.error("\u274C Please enter an RPC URL for the target network.");
                return;
            }

            console.log("\uD83D\uDD0C Connecting to RPC: " + rpcUrl);
            provider = new ethers.JsonRpcProvider(rpcUrl);

            const network = await provider.getNetwork();
            console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
            console.log("");

            console.log("\uD83D\uDD10 Connecting to Ledger device...");
            transport = await openTransport();
            signer = new LedgerEthSigner(transport, provider);

            const address = await signer.getAddress();
            const balance = await provider.getBalance(address);
            console.log("\u2705 Ledger connected");
            console.log("- Address: " + address);
            console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
            console.log("");
        } else {
            // ── Software mode: browser wallet (MetaMask / Rabby) ──────────
            if (typeof window === 'undefined' || !window.ethereum) {
                throw new Error(
                    "No wallet detected. Please install MetaMask, Rabby, or another Ethereum wallet.\n" +
                    "Download:\n" +
                    "  - MetaMask: https://metamask.io/\n" +
                    "  - Rabby: https://rabby.io/"
                );
            }

            // Check wallet chain matches dropdown selection
            const networkToChainId = {
                ethereum: '0x1',
                sepolia: '0xaa36a7',
                arbitrumSepolia: '0x66eee',
                baseSepolia: '0x14a34',
            };
            const selectedNetwork = document.getElementById('targetNetwork')?.value;
            const expectedChainHex = networkToChainId[selectedNetwork];

            await window.ethereum.request({ method: 'eth_requestAccounts' });

            const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
            if (expectedChainHex && currentChain.toLowerCase() !== expectedChainHex.toLowerCase()) {
                console.log("\u26A0\uFE0F Wallet is on a different chain. Requesting switch to " + selectedNetwork + "...");
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: expectedChainHex }],
                    });
                    console.log("\u2705 Chain switched successfully.");
                } catch (switchErr) {
                    throw new Error(
                        "Please switch your wallet to " + selectedNetwork +
                        " (chain " + expectedChainHex + ") to match the selected network."
                    );
                }
            }

            provider = new ethers.BrowserProvider(window.ethereum);
            signer = await provider.getSigner();

            const address = await signer.getAddress();
            const balance = await provider.getBalance(address);
            const network = await provider.getNetwork();

            console.log("\u2705 Wallet connected");
            console.log("- Address: " + address);
            console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
            console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
            console.log("");
        }

        // 2. Get public keys based on mode
        let preQuantumPubKey, pqPublicKey;

        if (mode === 'ledger') {
            // Ledger path — ML-DSA only (Falcon is software-only)
            const ecdsaPubkey = await getEcdsaPublicKey(transport, "m/44'/60'/0'/0/0");
            const raw = ecdsaPubkey.subarray(2, 66);
            const hash = ethers.keccak256(raw);
            preQuantumPubKey = ethers.getAddress('0x' + hash.slice(-40));
            console.log("\u2705 ECDSA address: " + preQuantumPubKey);
            console.log("");

            await deriveMldsaSeed(transport, "m/44'/60'/0'/0/0");
            pqPublicKey = await getMldsaPublicKey(transport);
            console.log("\u2705 ML-DSA public key retrieved (" + pqPublicKey.length + " bytes)");
        } else {
            const preQuantumSeed = document.getElementById('prequantum').value.trim();
            const postQuantumSeed = document.getElementById('postquantum').value.trim();

            try {
                validateSeed(preQuantumSeed, "Pre-quantum seed");
                validateSeed(postQuantumSeed, "Post-quantum seed");
            } catch (error) {
                console.error("\u274C Invalid seed: " + error.message);
                return;
            }

            preQuantumPubKey = await softEcdsaKeygen.getAddress({ privateKey: preQuantumSeed });

            if (pqAlgo === 'falcon') {
                pqPublicKey = await softFalconKeygen.getPublicKey({ postQuantumSeed });
            } else {
                pqPublicKey = await softMldsaKeygen.getPublicKey({ postQuantumSeed });
            }
        }

        // 3. Encode keys for the contract
        let postQuantumPubKey;
        if (pqAlgo === 'falcon') {
            postQuantumPubKey = toFalconEncodedBytes(pqPublicKey);
        } else {
            postQuantumPubKey = to_expanded_encoded_bytes(pqPublicKey);
        }

        // 4. Deploy
        console.log("");
        console.log("\uD83D\uDCE6 Deploying ERC4337 Account (" + accountMode + ")...");
        const accountResult = await deployERC4337Account(
            factoryAddress,
            preQuantumPubKey,
            postQuantumPubKey,
            signer
        );

        if (accountResult.success) {
            console.log("");
            console.log("============================================================");
            console.log("\uD83C\uDF89 DEPLOYMENT COMPLETE!");
            console.log("============================================================");
            console.log("\uD83D\uDD11 ERC4337 Account: " + accountResult.address);
            if (accountResult.transactionHash) {
                console.log("\uD83D\uDD0D Transaction Hash: " + accountResult.transactionHash);
            }
            if (accountResult.alreadyExists) {
                console.log("\u2139\uFE0F  Note: Account already existed at this address");
            }
            console.log("============================================================");
        } else {
            console.error("\u274C Deployment failed");
            if (accountResult.error) {
                console.error("Error: " + accountResult.error);
            }
        }

    } finally {
        // Always close the Ledger transport so the next click can reopen it
        if (transport) {
            try { await transport.close(); } catch (e) { }
        }
    }
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────

function setup() {
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

    console.log = function (...args) {
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        output.textContent += message + '\n';
        output.scrollTop = output.scrollHeight;
        originalLog.apply(console, args);
    };

    console.error = function (...args) {
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        output.textContent += '\u274C ' + message + '\n';
        output.scrollTop = output.scrollHeight;
        originalError.apply(console, args);
    };

    // Check for wallet on load
    if (typeof window !== 'undefined' && window.ethereum) {
        output.textContent = '\u2705 Wallet detected. Configure seeds above and click deploy.\n';
    } else {
        output.textContent = '\u26A0\uFE0F No browser wallet detected. Use Ledger mode or install MetaMask/Rabby.\n';
    }

    // ── Disable Ledger button when Falcon is selected ──
    const accountModeSelect = document.getElementById('accountMode');
    if (accountModeSelect && deployLedgerBtn) {
        accountModeSelect.addEventListener('change', () => {
            const isFalcon = accountModeSelect.value.startsWith('falcon');
            deployLedgerBtn.disabled = isFalcon;
            deployLedgerBtn.title = isFalcon
                ? 'Falcon is only available in software mode'
                : '';
        });
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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
} else {
    setup();
}
// ─── Factory ABI ──────────────────────────────────────────────────────────────

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
            console.log("\uD83D\uDD0C Connected via RPC URL:", signerOrProvider);

        } else if (signerOrProvider.signTransaction) {
            signer = signerOrProvider;
            provider = signer.provider;

        } else if (signerOrProvider.request) {
            console.log("\uD83D\uDD0C Connecting to browser wallet...");
            provider = new ethers.BrowserProvider(signerOrProvider);
            signer = await provider.getSigner();
            console.log("\u2705 Wallet connected");

        } else if (signerOrProvider.getNetwork) {
            provider = signerOrProvider;
            signer = await provider.getSigner();
            console.log("\uD83D\uDD0C Using provided Provider");

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
            const getAddressFn = factory.getFunction("getAddress");
            expectedAddress = await getAddressFn.staticCall(
                preQuantumPubKey,
                postQuantumPubKey
            );
        } catch (error) {
            console.error("\u274C Failed to calculate address: " + error.message);
            throw new Error("Cannot calculate account address: " + error.message);
        }

        if (!ethers.isAddress(expectedAddress)) {
            throw new Error("Invalid address returned from getAddress()");
        }

        const code = await provider.getCode(expectedAddress);
        if (code !== '0x') {
            console.log("\u2705 Account already exists at: " + expectedAddress);
            return {
                success: true,
                address: expectedAddress,
                alreadyExists: true
            };
        }

        console.log("");
        console.log("\u26FD Estimating gas...");
        let estimatedGas;
        try {
            estimatedGas = await factory.createAccount.estimateGas(
                preQuantumPubKey,
                postQuantumPubKey
            );
            console.log("- Estimated gas: " + estimatedGas.toString());
        } catch (error) {
            console.error("\u26A0\uFE0F  Gas estimation failed: " + error.message);
            estimatedGas = 5000000n;
            console.log("- Using default gas limit: " + estimatedGas.toString());
        }

        const feeData = await provider.getFeeData();
        const gasCostWei = estimatedGas * (feeData.gasPrice || feeData.maxFeePerGas || 0n);
        console.log("- Gas price: " + ethers.formatUnits(feeData.gasPrice || feeData.maxFeePerGas || 0n, "gwei") + " gwei");
        console.log("- Estimated cost: " + ethers.formatEther(gasCostWei) + " ETH");

        console.log("");
        console.log("\uD83D\uDE80 Creating ERC4337 account...");
        console.log("\u23F3 Please confirm the transaction...");

        const tx = await factory.createAccount(
            preQuantumPubKey,
            postQuantumPubKey,
            { gasLimit: estimatedGas * 120n / 100n }
        );

        const txHash = tx.hash;
        console.log("\u2705 Transaction signed!");
        console.log("- Transaction hash: " + txHash);

        let explorerUrl = "";
        if (network.chainId === 1n) {
            explorerUrl = "https://etherscan.io/tx/" + txHash;
        } else if (network.chainId === 11155111n) {
            explorerUrl = "https://sepolia.etherscan.io/tx/" + txHash;
        } else if (network.chainId === 421614n) {
            explorerUrl = "https://sepolia.arbiscan.io/tx/" + txHash;
        } else if (network.chainId === 84532n) {
            explorerUrl = "https://sepolia.basescan.org/tx/" + txHash;
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
                    console.log("  \u23F3 Waiting... " + elapsed + "s elapsed");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (error) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        if (!receipt) {
            console.log("");
            console.log("\u26A0\uFE0F  Transaction is taking longer than expected");
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
            console.log("\u274C Transaction failed (reverted)");
            return {
                success: false,
                error: "Transaction reverted",
                transactionHash: txHash
            };
        }

        console.log("");
        console.log("\u2705 ERC4337 Account created successfully!");
        console.log("- Account address: " + expectedAddress);
        console.log("- Block number: " + receipt.blockNumber);
        console.log("- Gas used: " + receipt.gasUsed.toString());

        const actualCost = receipt.gasUsed * (receipt.gasPrice || receipt.effectiveGasPrice || 0n);
        console.log("- Actual cost: " + ethers.formatEther(actualCost) + " ETH");

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
        console.error("\u274C Account creation failed: " + error.message);
        if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
            console.log("(User rejected the transaction in wallet)");
        }
        return {
            success: false,
            error: error.message
        };
    }
}
