import { ethers } from 'ethers';
import {
    signHybridUserOp,
} from './hardware-signer/ledgerTransport.js';

import {
    createBaseUserOperation,
    signUserOpHybrid,
    estimateUserOperationGas,
    updateUserOpWithGasEstimates,
    submitUserOperation,
    ENTRY_POINT_ADDRESS
} from './userOperation.js';

import * as softMldsa from './software-signer/mldsaSigner.js';
import * as softFalcon from './software-signer/falconSigner.js';
import * as softEcdsa from './software-signer/ecdsaSigner.js';
import * as hwMldsa from './hardware-signer/mldsaSigner.js';
import * as hwEcdsa from './hardware-signer/ecdsaSigner.js';

/**
 * Return the correct {pq, ecdsa} signer pair based on signing mode and
 * selected PQ algorithm.
 *
 * @param {'soft'|'ledger'} mode
 * @param {'mldsa'|'falcon'} pqAlgo
 */
function getSigners(mode, pqAlgo) {
    if (mode === 'ledger') {
        // Ledger only supports ML-DSA for now
        return { pq: hwMldsa, ecdsa: hwEcdsa };
    }
    return {
        pq: pqAlgo === 'falcon' ? softFalcon : softMldsa,
        ecdsa: softEcdsa,
    };
}

/**
 * Max detached-signature size used for the dummy signature during gas
 * estimation.  ML-DSA-44 = 2420 B, Falcon-512 ≈ 1109 B (2+40+1067).
 */
function pqDummySigLen(pqAlgo) {
    return pqAlgo === 'falcon' ? 1064 : 2420;
}

export async function sendERC4337Transaction(
    accountAddress, targetAddress, value, callData,
    preQuantumSeed, signingMode, postQuantumSeed,
    provider, bundlerUrl, pqAlgo = 'mldsa'
) {
    const { pq, ecdsa } = getSigners(signingMode, pqAlgo);

    try {
        console.log("🚀 Sending ERC4337 Transaction...");
        console.log("- PQ algorithm: " + (pqAlgo === 'falcon' ? 'Falcon-512' : 'ML-DSA-44'));
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
            hwMldsa.setTransport(ecdsa.getTransport());
            await pq.init();
        } else {
            await ecdsa.init({ privateKey: preQuantumSeed });
            await pq.init({ postQuantumSeed });
        }
        console.log("");

        // 1. Create base UserOp
        let userOp = await createBaseUserOperation(
            accountAddress, targetAddress, value, callData, provider, bundlerUrl
        );

        // 2. Use dummy signature for gas estimation
        userOp.signature = getDummySignature(pqAlgo);

        // 3. Estimate gas
        const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);

        // 4. Update gas limits
        userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);

        // 5. Real sign
        if (signingMode === 'ledger') {
            // Clear-sign: send UserOp fields to device for on-chip hash + display
            const result = await signHybridUserOp(
                ecdsa.getTransport(),
                "m/44'/60'/0'/0/0",
                userOp,
                ENTRY_POINT_ADDRESS,
                network.chainId
            );

            // Encode ECDSA as 65 bytes: r(32) || s(32) || v(1)
            const ecdsaSig = ethers.concat([
                result.ecdsaR,
                result.ecdsaS,
                ethers.toBeHex(result.ecdsaV + 27, 1),
            ]);

            // ABI-encode the hybrid signature
            const abi = ethers.AbiCoder.defaultAbiCoder();
            userOp.signature = abi.encode(
                ["bytes", "bytes"],
                [ecdsaSig, result.mldsaSignature]
            );
        } else {
            // Software: signs separately (works for both ML-DSA and Falcon)
            userOp.signature = await signUserOpHybrid(
                userOp, ENTRY_POINT_ADDRESS, network.chainId,
                ecdsa, pq
            );
        }
        const algoLabel = pqAlgo === 'falcon' ? 'Falcon-512' : 'ML-DSA-44';
        console.log("✅ ECDSA and " + algoLabel + " signature generated.");

        // Debug: inspect final signature
        console.log("🔍 Final userOp.signature length: " + ((userOp.signature.length - 2) / 2) + " bytes");
        console.log("🔍 Final userOp.signature (first 200 chars): " + userOp.signature.slice(0, 200) + "...");

        // Submit or preview
        if (!bundlerUrl || bundlerUrl.trim() === '' || bundlerUrl.includes('example.com')) {
            console.log("");
            console.log("ℹ️  No valid bundler URL provided");
            console.log("✅ UserOperation created and signed successfully!");
            console.log("");
            console.log("📄 UserOperation Preview:");
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
            console.log("- UserOp Hash: " + userOpHash);
            console.log("=".repeat(60));
            console.log("");
            console.log("⏳ Waiting for transaction to be mined...");

            const receipt = await waitForUserOperationReceipt(userOpHash, bundlerUrl);
            if (receipt) {
                console.log("✅ Transaction mined!");
                if (receipt.receipt?.transactionHash) {
                    console.log("- Tx Hash: " + receipt.receipt.transactionHash);
                }
                if (receipt.receipt?.blockNumber) {
                    console.log("- Block: " + (typeof receipt.receipt.blockNumber === 'string'
                        ? parseInt(receipt.receipt.blockNumber, 16)
                        : receipt.receipt.blockNumber));
                }
                if (receipt.success === false) {
                    console.log("⚠️  UserOp execution reverted on-chain");
                }
            } else {
                console.log("⚠️  Timed out waiting for receipt. The tx may still be pending.");
                console.log("   You can submit another transaction once it confirms.");
            }

            return { success: true, userOpHash, receipt };
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
        await pq.cleanup();
        await ecdsa.cleanup();
    }
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────

function setup() {
    const button = document.getElementById('sendTx');
    const output = document.getElementById('output');
    const signingModeRadios = document.getElementsByName('signingMode');
    const softSeedGroup = document.getElementById('softSeedGroup');
    const ledgerInfoGroup = document.getElementById('ledgerInfoGroup');

    if (!button || !output) { console.error('Missing UI elements'); return; }

    function updateSeedVisibility() {
        const mode = document.querySelector('input[name="signingMode"]:checked').value;
        if (softSeedGroup) softSeedGroup.style.display = (mode === 'soft') ? '' : 'none';
        if (ledgerInfoGroup) ledgerInfoGroup.style.display = (mode === 'ledger') ? '' : 'none';
    }
    signingModeRadios.forEach(r => r.addEventListener('change', updateSeedVisibility));
    updateSeedVisibility();

    // ── Disable Ledger radio when Falcon is selected ──
    const pqAlgoSelect = document.getElementById('pqAlgo');
    const ledgerRadio = document.getElementById('modeLedger');
    if (pqAlgoSelect && ledgerRadio) {
        pqAlgoSelect.addEventListener('change', () => {
            const isFalcon = pqAlgoSelect.value === 'falcon';
            ledgerRadio.disabled = isFalcon;
            if (isFalcon && ledgerRadio.checked) {
                // Force switch to software mode
                document.getElementById('modeSoft').checked = true;
                updateSeedVisibility();
            }
        });
    }

    const originalLog = console.log;
    const originalError = console.error;

    console.log = function (...args) {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
        output.textContent += msg + '\n';
        output.scrollTop = output.scrollHeight;
        originalLog.apply(console, args);
    };
    console.error = function (...args) {
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
            const rpcUrl = document.getElementById('rpcUrl')?.value.trim();
            if (!rpcUrl) {
                console.log('\u274C Please enter an RPC URL for the target network.');
                return;
            }

            console.log('\uD83D\uDD0C Connecting to RPC: ' + rpcUrl);
            const provider = new ethers.JsonRpcProvider(rpcUrl);

            const network = await provider.getNetwork();
            console.log('\u2705 Connected to ' + network.name + ' (Chain ID: ' + network.chainId + ')');
            console.log("");

            const signingMode = document.querySelector('input[name="signingMode"]:checked').value;
            const pqAlgo = document.getElementById('pqAlgo')?.value || 'mldsa';

            const preQuantumSeed = signingMode === 'ledger'
                ? '' // not needed — Ledger signs ECDSA on device
                : document.getElementById('preQuantumSeed').value.trim();

            const postQuantumSeed = document.getElementById('postQuantumSeed')?.value.trim() || '';
            const pimlicoApiKey = document.getElementById('pimlicoApiKey').value.trim();
            const accountAddress = document.getElementById('accountAddress').value.trim();
            const targetAddress = document.getElementById('targetAddress').value.trim();
            const valueEth = document.getElementById('value').value.trim();
            const callData = document.getElementById('callData').value.trim();

            const bundlerUrl = 'https://api.pimlico.io/v2/' + network.chainId + '/rpc?apikey=' + pimlicoApiKey;

            await sendERC4337Transaction(
                accountAddress, targetAddress, ethers.parseEther(valueEth), callData,
                preQuantumSeed, signingMode, postQuantumSeed,
                provider, bundlerUrl, pqAlgo
            );

        } catch (error) {
            console.error('Error: ' + error.message);
        } finally {
            button.disabled = false;
        }
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
} else {
    setup();
}

/**
 * Build a dummy hybrid signature for gas estimation.
 * @param {'mldsa'|'falcon'} pqAlgo
 */
export function getDummySignature(pqAlgo = 'mldsa') {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const dummyEcdsa = ethers.hexlify(new Uint8Array(65).fill(0xff));
    const dummyPq = ethers.hexlify(new Uint8Array(pqDummySigLen(pqAlgo)).fill(0xff));
    return abi.encode(["bytes", "bytes"], [dummyEcdsa, dummyPq]);
}

/**
 * Poll the bundler for a UserOperation receipt until it is mined.
 * @param {string} userOpHash
 * @param {string} bundlerUrl
 * @param {number} [timeoutMs=120000]  — give up after this many ms
 * @param {number} [intervalMs=3000]   — poll every N ms
 * @returns {object|null} receipt, or null on timeout
 */
async function waitForUserOperationReceipt(
    userOpHash, bundlerUrl, timeoutMs = 120_000, intervalMs = 3_000
) {
    const deadline = Date.now() + timeoutMs;
    let elapsed = 0;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(bundlerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 1,
                    method: 'eth_getUserOperationReceipt',
                    params: [userOpHash]
                })
            });
            const result = await response.json();

            if (result.result) {
                return result.result;
            }
        } catch (e) {
            // Network hiccup — keep polling
        }

        elapsed += intervalMs;
        if (elapsed % 15_000 === 0) {
            console.log("  ⏳ Still waiting... " + (elapsed / 1000) + "s elapsed");
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return null;
}
