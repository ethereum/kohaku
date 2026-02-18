import { ethers } from 'ethers';
import { nttCompact, redirectConsole, explorerTxUrl } from './utils.js';
import { to_expanded_encoded_bytes } from './utils_mldsa.js';
import * as softEcdsaKeygen  from './software-signer/ecdsaKeygen.js';
import * as softMldsaKeygen  from './software-signer/mldsaKeygen.js';
import * as softFalconKeygen from './software-signer/falconKeygen.js';
import {
    openTransport,
    deriveMldsaSeed,
    getMldsaPublicKey,
    getEcdsaPublicKey,
} from './hardware-signer/ledgerTransport.js';
import { LedgerEthSigner } from './LedgerEthSigner.js';

// ─── Helpers ────────────────────────────────────────────────────────────

function validateSeed(seed, name) {
    if (!seed.startsWith("0x"))
        throw new Error(`${name} must start with "0x"`);
    if (seed.length !== 66)
        throw new Error(`${name} must be 32 bytes (66 characters including 0x, got ${seed.length})`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(seed))
        throw new Error(`${name} contains invalid hex characters`);
}

/**
 * Encode a Falcon-512 public key for the on-chain verifier.
 */
function toFalconEncodedBytes(falconPublicKey) {
    if (falconPublicKey.length !== 1025)
        throw new Error("Expected 1025-byte Falcon-512 public key, got " + falconPublicKey.length);

    // 512 coefficients (16-bit big-endian), skipping the 1-byte header
    const coeffs = [];
    for (let i = 0; i < 512; i++) {
        const offset = 1 + i * 2;
        coeffs.push((falconPublicKey[offset] << 8) | falconPublicKey[offset + 1]);
    }

    const packed = nttCompact(coeffs);

    let hex = "0x";
    for (const word of packed) {
        hex += word.toString(16).padStart(64, "0");
    }
    return hex;
}

// ─── Main flow ──────────────────────────────────────────────────────────

async function main(mode) {
    const factoryAddress = document.getElementById('factory').textContent.trim();
    if (!factoryAddress || factoryAddress === '\u2014') {
        console.error("No factory address found for this network.");
        return;
    }

    const accountMode = document.getElementById('accountMode')?.value || 'mldsa_k1';
    const pqAlgo = accountMode.startsWith('falcon') ? 'falcon' : 'mldsa';

    let provider, signer, transport;

    try {
        if (mode === 'ledger') {
            if (pqAlgo === 'falcon') {
                console.error("Falcon is only available in software mode.");
                return;
            }

            const rpcUrl = document.getElementById('rpcUrl')?.value.trim();
            if (!rpcUrl) { console.error("Please enter an RPC URL."); return; }

            console.log("🔌 Connecting to RPC: " + rpcUrl);
            provider = new ethers.JsonRpcProvider(rpcUrl);
            const network = await provider.getNetwork();
            console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");

            console.log("🔐 Connecting to Ledger device...");
            transport = await openTransport();
            signer = new LedgerEthSigner(transport, provider);

            const address = await signer.getAddress();
            const balance = await provider.getBalance(address);
            console.log("✅ Ledger connected — " + address);
            console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
        } else {
            if (typeof window === 'undefined' || !window.ethereum) {
                throw new Error(
                    "No wallet detected. Install MetaMask (https://metamask.io/) or Rabby (https://rabby.io/)."
                );
            }

            // Ensure wallet chain matches dropdown
            const networkToChainId = {
                sepolia: '0xaa36a7',
                arbitrumSepolia: '0x66eee', baseSepolia: '0x14a34',
            };
            const selectedNetwork  = document.getElementById('targetNetwork')?.value;
            const expectedChainHex = networkToChainId[selectedNetwork];

            await window.ethereum.request({ method: 'eth_requestAccounts' });

            const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
            if (expectedChainHex && currentChain.toLowerCase() !== expectedChainHex.toLowerCase()) {
                console.log("⚠️ Wallet on different chain, switching to " + selectedNetwork + "...");
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: expectedChainHex }],
                    });
                } catch (_) {
                    throw new Error("Please switch your wallet to " + selectedNetwork + " (" + expectedChainHex + ").");
                }
            }

            provider = new ethers.BrowserProvider(window.ethereum);
            signer   = await provider.getSigner();

            const address = await signer.getAddress();
            const balance = await provider.getBalance(address);
            const network = await provider.getNetwork();

            console.log("✅ Wallet connected — " + address);
            console.log("- Balance: " + ethers.formatEther(balance) + " ETH");
            console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
        }

        // Get public keys
        let preQuantumPubKey, pqPublicKey;

        if (mode === 'ledger') {
            const ecdsaPubkey = await getEcdsaPublicKey(transport, "m/44'/60'/0'/0/0");
            const raw  = ecdsaPubkey.subarray(2, 66);
            const hash = ethers.keccak256(raw);
            preQuantumPubKey = ethers.getAddress('0x' + hash.slice(-40));
            console.log("✅ ECDSA address: " + preQuantumPubKey);

            await deriveMldsaSeed(transport, "m/44'/60'/0'/0/0");
            pqPublicKey = await getMldsaPublicKey(transport);
            console.log("✅ ML-DSA public key retrieved (" + pqPublicKey.length + " bytes)");
        } else {
            const preQuantumSeed  = document.getElementById('prequantum').value.trim();
            const postQuantumSeed = document.getElementById('postquantum').value.trim();

            try {
                validateSeed(preQuantumSeed, "Pre-quantum seed");
                validateSeed(postQuantumSeed, "Post-quantum seed");
            } catch (error) {
                console.error("Invalid seed: " + error.message);
                return;
            }

            preQuantumPubKey = await softEcdsaKeygen.getAddress({ privateKey: preQuantumSeed });

            if (pqAlgo === 'falcon') {
                pqPublicKey = await softFalconKeygen.getPublicKey({ postQuantumSeed });
            } else {
                pqPublicKey = await softMldsaKeygen.getPublicKey({ postQuantumSeed });
            }
        }

        // Encode keys for the contract
        const postQuantumPubKey = pqAlgo === 'falcon'
            ? toFalconEncodedBytes(pqPublicKey)
            : to_expanded_encoded_bytes(pqPublicKey);

        // Deploy
        console.log("📦 Deploying ERC-4337 account (" + accountMode + ")...");
        const result = await deployERC4337Account(
            factoryAddress, preQuantumPubKey, postQuantumPubKey, signer
        );

        if (result.success) {
            console.log("============================================================");
            console.log("🎉 DEPLOYMENT COMPLETE!");
            console.log("🔑 Account: " + result.address);
            if (result.transactionHash) console.log("🔍 Tx: " + result.transactionHash);
            if (result.alreadyExists)   console.log("ℹ️  Account already existed at this address");
            console.log("============================================================");
        } else {
            console.error("Deployment failed" + (result.error ? ": " + result.error : ""));
        }

    } finally {
        if (transport) {
            try { await transport.close(); } catch (_) {}
        }
    }
}

// ─── UI Setup ───────────────────────────────────────────────────────────

function setup() {
    const deployBtn       = document.getElementById('deploy');
    const deployLedgerBtn = document.getElementById('deploy-ledger');
    const output          = document.getElementById('output');

    if (!output) { console.error('Missing UI elements'); return; }

    redirectConsole(output);

    // Initial status
    if (typeof window !== 'undefined' && window.ethereum) {
        output.textContent = '✅ Wallet detected. Configure seeds above and click deploy.\n';
    } else {
        output.textContent = '⚠️ No browser wallet detected. Use Ledger mode or install MetaMask/Rabby.\n';
    }

    // Disable Ledger button when Falcon is selected
    const accountModeSelect = document.getElementById('accountMode');
    if (accountModeSelect && deployLedgerBtn) {
        accountModeSelect.addEventListener('change', () => {
            const isFalcon = accountModeSelect.value.startsWith('falcon');
            deployLedgerBtn.disabled = isFalcon;
            deployLedgerBtn.title = isFalcon ? 'Falcon is only available in software mode' : '';
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
                console.log("(User rejected the transaction)");
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    if (deployBtn)       deployBtn.addEventListener('click', () => run('soft'));
    if (deployLedgerBtn) deployLedgerBtn.addEventListener('click', () => run('ledger'));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
} else {
    setup();
}

// ─── Factory ABI & deployment ───────────────────────────────────────────

const ACCOUNT_FACTORY_ABI = [
    "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
    "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address payable)",
    "function entryPoint() external view returns (address)",
    "function preQuantumLogic() external view returns (address)",
    "function postQuantumLogic() external view returns (address)",
    "function hybridVerifierLogic() external view returns (address)"
];

/**
 * Deploy an ERC-4337 account via the factory contract.
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
            const getAddressFn = factory.getFunction("getAddress");
            expectedAddress = await getAddressFn.staticCall(
                preQuantumPubKey,
                postQuantumPubKey
            );
        } catch (error) {
            console.error("Failed to calculate address: " + error.message);
            throw new Error("Cannot calculate account address: " + error.message);
        }

        if (!ethers.isAddress(expectedAddress)) {
            throw new Error("Invalid address returned from getAddress()");
        }

        const code = await provider.getCode(expectedAddress);
        if (code !== '0x') {
            console.log("✅ Account already exists at: " + expectedAddress);
            return {
                success: true,
                address: expectedAddress,
                alreadyExists: true
            };
        }

        console.log("⛽ Estimating gas...");
        let estimatedGas;
        try {
            estimatedGas = await factory.createAccount.estimateGas(
                preQuantumPubKey,
                postQuantumPubKey
            );
            console.log("- Estimated gas: " + estimatedGas.toString());
        } catch (error) {
            console.warn("Gas estimation failed: " + error.message);
            estimatedGas = 5000000n;
            console.log("- Using default gas limit: " + estimatedGas.toString());
        }

        const feeData = await provider.getFeeData();
        const gasCostWei = estimatedGas * (feeData.gasPrice || feeData.maxFeePerGas || 0n);
        console.log("- Gas price: " + ethers.formatUnits(feeData.gasPrice || feeData.maxFeePerGas || 0n, "gwei") + " gwei");
        console.log("- Estimated cost: " + ethers.formatEther(gasCostWei) + " ETH");

        console.log("🚀 Creating account — please confirm the transaction...");

        const tx = await factory.createAccount(
            preQuantumPubKey,
            postQuantumPubKey,
            { gasLimit: estimatedGas * 120n / 100n }
        );

        const txHash = tx.hash;
        console.log("✅ Transaction signed: " + txHash);

        const url = explorerTxUrl(network.chainId, txHash);
        if (url) console.log("- Explorer: " + url);

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
            console.log("⚠️  Transaction is taking longer than expected");
            console.log("Check status at: " + (url || txHash));
            return {
                success: false,
                pending: true,
                transactionHash: txHash,
                expectedAddress
            };
        }

        if (receipt.status === 0) {
            console.log("❌ Transaction failed (reverted)");
            return {
                success: false,
                error: "Transaction reverted",
                transactionHash: txHash
            };
        }

        console.log("✅ ERC4337 Account created successfully!");
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
        console.error("Account creation failed: " + error.message);
        if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
            console.log("(User rejected the transaction in wallet)");
        }
        return {
            success: false,
            error: error.message
        };
    }
}
