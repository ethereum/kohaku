import { ethers } from 'ethers';
import {
    createBaseUserOperation,
    signUserOpHybrid,
    estimateUserOperationGas,
    updateUserOpWithGasEstimates,
    submitUserOperation,
    ENTRY_POINT_ADDRESS
} from './userOperation.js';

import * as softMldsa  from './software-signer/mldsaSigner.js';
import * as softEcdsa  from './software-signer/ecdsaSigner.js';
import * as hwMldsa    from './hardware-signer/mldsaSigner.js';
import * as hwEcdsa    from './hardware-signer/ecdsaSigner.js';

function getSigners(mode) {
    return mode === 'ledger'
        ? { mldsa: hwMldsa, ecdsa: hwEcdsa }
        : { mldsa: softMldsa, ecdsa: softEcdsa };
}

export async function sendERC4337Transaction(
    accountAddress, targetAddress, value, callData,
    preQuantumSeed, signingMode, postQuantumSeed,
    provider, bundlerUrl
) {
    const { mldsa, ecdsa } = getSigners(signingMode);

    try {
        console.log("🚀 Sending ERC4337 Transaction...");
        console.log("");

        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();

        console.log("📋 Transaction Details:");
        console.log("- From (Account): " + accountAddress);
        console.log("- To: " + targetAddress);
        console.log("- Value: " + ethers.formatEther(value) + " ETH");
        console.log("- Call Data: " + callData);
        console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
        console.log("- Block number:", blockNumber);
        console.log("");

        const accountBalance = await provider.getBalance(accountAddress);
        console.log("💰 Account Balance: " + ethers.formatEther(accountBalance) + " ETH");

        if (accountBalance === 0n) {
            console.log("⚠️  WARNING: Account has no balance!");
            console.log("You need to send ETH to: " + accountAddress);
            console.log("");
        }

        // Initialize signers
        if (signingMode === 'ledger') {
            await ecdsa.init();
            // Share the transport so we don't open two HID connections
            hwMldsa.setTransport(ecdsa.getTransport());
            await mldsa.init();
        } else {
            await ecdsa.init({ privateKey: preQuantumSeed });
            await mldsa.init({ postQuantumSeed });
        }
        console.log("");

        // 1. Create base UserOp
        let userOp = await createBaseUserOperation(
            accountAddress, targetAddress, value, callData, provider, bundlerUrl
        );

        // 2. Use dummy signature for gas estimation
        userOp.signature = getDummySignature();

        // 3. Estimate gas
        const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);

        // 4. Update gas limits
        userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);

        // 5. Real sign
        userOp.signature = await signUserOpHybrid(
            userOp, ENTRY_POINT_ADDRESS, network.chainId,
            ecdsa, mldsa
        );
        console.log("✅ ECDSA and MLDSA signature generated.");

        // Submit or preview
        if (!bundlerUrl || bundlerUrl.trim() === '' || bundlerUrl.includes('example.com')) {
            console.log("");
            console.log("ℹ️  No valid bundler URL provided");
            console.log("✅ UserOperation created and signed successfully!");
            console.log("");
            console.log("🔄 UserOperation Preview:");
            console.log(JSON.stringify({
                sender: userOp.sender ?? "<undefined>",
                nonce: '0x' + ((userOp.nonce ?? 0).toString(16)),
                callData: userOp.callData ? userOp.callData.slice(0, 50) + '...' : "<undefined>",
                signature: userOp.signature ? userOp.signature.slice(0, 50) + '...' : "<undefined>"
            }, null, 2));
            return { success: true, userOp, message: "UserOperation created and signed (bundler needed)" };
        }

        try {
            const userOpHash = await submitUserOperation(userOp, bundlerUrl, ENTRY_POINT_ADDRESS);
            console.log("");
            console.log("=".repeat(60));
            console.log("🎉 TRANSACTION SUBMITTED!");
            console.log("=".repeat(60));
            return { success: true, userOpHash };
        } catch (error) {
            console.error("❌ Failed to submit to bundler: " + error.message);
            return { success: false, error: error.message, userOp };
        }

    } catch (error) {
        console.error("");
        console.error("❌ Transaction failed: " + error.message);
        if (error.stack) console.log("Stack trace:\n" + error.stack);
        return { success: false, error: error.message };
    } finally {
        await mldsa.cleanup();
        await ecdsa.cleanup();
    }
}

// ─── UI Setup (unchanged except preQuantumSeed handling) ────────────────

document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('sendTx');
    const output = document.getElementById('output');
    const signingModeRadios = document.getElementsByName('signingMode');
    const softSeedGroup = document.getElementById('softSeedGroup');
    const ledgerInfoGroup = document.getElementById('ledgerInfoGroup');

    if (!button || !output) { console.error('Missing UI elements'); return; }

    function updateSeedVisibility() {
        const mode = document.querySelector('input[name="signingMode"]:checked').value;
        if (softSeedGroup)   softSeedGroup.style.display   = (mode === 'soft')   ? '' : 'none';
        if (ledgerInfoGroup) ledgerInfoGroup.style.display  = (mode === 'ledger') ? '' : 'none';
    }
    signingModeRadios.forEach(r => r.addEventListener('change', updateSeedVisibility));
    updateSeedVisibility();

    const originalLog = console.log;
    const originalError = console.error;

    console.log = function(...args) {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
        output.textContent += msg + '\n';
        output.scrollTop = output.scrollHeight;
        originalLog.apply(console, args);
    };
    console.error = function(...args) {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
        output.textContent += '❌ ' + msg + '\n';
        output.scrollTop = output.scrollHeight;
        originalError.apply(console, args);
    };

    output.textContent = '✅ Ready to send a transaction.\nChoose your signing mode and fill in the details above.\n';

    button.addEventListener('click', async () => {
        button.disabled = true;
        output.textContent = '';

        try {
            if (!window.ethereum) {
                console.log('❌ No wallet detected! Please install MetaMask or Rabby.');
                return;
            }

            console.log('🔌 Connecting to wallet...');
            await window.ethereum.request({ method: 'eth_requestAccounts' });

            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            console.log('✅ Wallet connected: ' + await signer.getAddress());
            console.log("");

            const signingMode = document.querySelector('input[name="signingMode"]:checked').value;

            const preQuantumSeed = signingMode === 'ledger'
                ? '' // not needed — Ledger signs ECDSA on device
                : document.getElementById('preQuantumSeed').value.trim();

            const postQuantumSeed = document.getElementById('postQuantumSeed')?.value.trim() || '';
            const pimlicoApiKey = document.getElementById('pimlicoApiKey').value.trim();
            const accountAddress = document.getElementById('accountAddress').value.trim();
            const targetAddress = document.getElementById('targetAddress').value.trim();
            const valueEth = document.getElementById('value').value.trim();
            const callData = document.getElementById('callData').value.trim();

            const network = await provider.getNetwork();
            const bundlerUrl = 'https://api.pimlico.io/v2/' + network.chainId + '/rpc?apikey=' + pimlicoApiKey;

            await sendERC4337Transaction(
                accountAddress, targetAddress, ethers.parseEther(valueEth), callData,
                preQuantumSeed, signingMode, postQuantumSeed,
                provider, bundlerUrl
            );

        } catch (error) {
            console.error('Error: ' + error.message);
        } finally {
            button.disabled = false;
        }
    });
});

export function getDummySignature() {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    // 65 bytes of 0xff for ECDSA + 2420 bytes of 0xff for ML-DSA
    const dummyEcdsa = ethers.hexlify(new Uint8Array(65).fill(0xff));
    const dummyMldsa = ethers.hexlify(new Uint8Array(2420).fill(0xff));
    return abi.encode(["bytes", "bytes"], [dummyEcdsa, dummyMldsa]);
}