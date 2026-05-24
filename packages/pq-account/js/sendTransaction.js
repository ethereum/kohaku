import { ethers } from 'ethers';
import { redirectConsole } from './utils.js';
import { signHybridUserOp } from './hardware-signer/ledgerTransport.js';

import {
    createBaseUserOperation,
    signUserOpHybrid,
    estimateUserOperationGas,
    updateUserOpWithGasEstimates,
    submitUserOperation,
    ENTRY_POINT_ADDRESS
} from './userOperation.js';

import * as softMldsa  from './software-signer/mldsaSigner.js';
import * as softFalcon from './software-signer/falconSigner.js';
import * as softEcdsa  from './software-signer/ecdsaSigner.js';
import * as hwMldsa    from './hardware-signer/mldsaSigner.js';
import * as hwEcdsa    from './hardware-signer/ecdsaSigner.js';

/**
 * Return the correct { pq, ecdsa } signer pair.
 */
function getSigners(mode, pqAlgo) {
    if (mode === 'ledger') return { pq: hwMldsa, ecdsa: hwEcdsa };
    return {
        pq:    pqAlgo === 'falcon' ? softFalcon : softMldsa,
        ecdsa: softEcdsa,
    };
}

/**
 * Dummy PQ signature length for gas estimation.
 * ML-DSA-44 = 2420 B, Falcon-512 ≈ 1064 B.
 */
function pqDummySigLen(pqAlgo) {
    return pqAlgo === 'falcon' ? 1064 : 2420;
}

/**
 * Build a dummy hybrid signature for gas estimation.
 */
export function getDummySignature(pqAlgo = 'mldsa') {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const dummyEcdsa = ethers.hexlify(new Uint8Array(65).fill(0xff));
    const dummyPq    = ethers.hexlify(new Uint8Array(pqDummySigLen(pqAlgo)).fill(0xff));
    return abi.encode(["bytes", "bytes"], [dummyEcdsa, dummyPq]);
}

// ─── Main flow ──────────────────────────────────────────────────────────

export async function sendERC4337Transaction(
    accountAddress, targetAddress, value, callData,
    preQuantumSeed, signingMode, postQuantumSeed,
    provider, bundlerUrl, pqAlgo = 'mldsa'
) {
    const { pq, ecdsa } = getSigners(signingMode, pqAlgo);
    const algoLabel = pqAlgo === 'falcon' ? 'Falcon-512' : 'ML-DSA-44';

    try {
        const network = await provider.getNetwork();
        const accountBalance = await provider.getBalance(accountAddress);

        console.log("Sending ERC-4337 transaction (" + algoLabel + ")");
        console.log("- From: " + accountAddress);
        console.log("- To: " + targetAddress);
        console.log("- Value: " + ethers.formatEther(value) + " ETH");
        console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
        console.log("- Balance: " + ethers.formatEther(accountBalance) + " ETH");

        if (accountBalance === 0n) {
            console.log("⚠️  Account has no balance — send ETH to: " + accountAddress);
        }

        // Initialise signers
        if (signingMode === 'ledger') {
            await ecdsa.init();
            hwMldsa.setTransport(ecdsa.getTransport());
            await pq.init();
        } else {
            await ecdsa.init({ privateKey: preQuantumSeed });
            await pq.init({ postQuantumSeed });
        }

        // 1. Create base UserOp
        let userOp = await createBaseUserOperation(
            accountAddress, targetAddress, value, callData, provider, bundlerUrl
        );

        // 2. Dummy signature for gas estimation
        userOp.signature = getDummySignature(pqAlgo);

        // 3. Estimate gas
        const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);

        // 4. Update gas limits
        userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);

        // 5. Real sign
        if (signingMode === 'ledger') {
            const result = await signHybridUserOp(
                ecdsa.getTransport(),
                "m/44'/60'/0'/0/0",
                userOp,
                ENTRY_POINT_ADDRESS,
                network.chainId
            );
            const ecdsaSig = ethers.concat([
                result.ecdsaR,
                result.ecdsaS,
                ethers.toBeHex(result.ecdsaV + 27, 1),
            ]);
            const abi = ethers.AbiCoder.defaultAbiCoder();
            userOp.signature = abi.encode(["bytes", "bytes"], [ecdsaSig, result.mldsaSignature]);
        } else {
            userOp.signature = await signUserOpHybrid(
                userOp, ENTRY_POINT_ADDRESS, network.chainId, ecdsa, pq
            );
        }
        console.log("✅ Hybrid signature generated (ECDSA + " + algoLabel + ")");

        // Submit or preview
        if (!bundlerUrl || bundlerUrl.trim() === '' || bundlerUrl.includes('example.com')) {
            console.log("ℹ️  No valid bundler URL — UserOp created and signed but not submitted.");
            console.log(JSON.stringify({
                sender:    userOp.sender ?? "<undefined>",
                nonce:     '0x' + ((userOp.nonce ?? 0).toString(16)),
                callData:  userOp.callData  ? userOp.callData.slice(0, 50) + '...'  : "<undefined>",
                signature: userOp.signature ? userOp.signature.slice(0, 50) + '...' : "<undefined>"
            }, null, 2));
            return { success: true, userOp, message: "UserOperation created and signed (bundler needed)" };
        }

        try {
            const userOpHash = await submitUserOperation(userOp, bundlerUrl, ENTRY_POINT_ADDRESS);
            console.log("🎉 UserOp submitted — hash: " + userOpHash);
            console.log("⏳ Waiting for transaction to be mined...");

            const receipt = await waitForUserOperationReceipt(userOpHash, bundlerUrl);
            if (receipt) {
                console.log("✅ Transaction mined!");
                if (receipt.receipt?.transactionHash) {
                    console.log("- Tx Hash: " + receipt.receipt.transactionHash);
                }
                if (receipt.receipt?.blockNumber) {
                    const block = typeof receipt.receipt.blockNumber === 'string'
                        ? parseInt(receipt.receipt.blockNumber, 16)
                        : receipt.receipt.blockNumber;
                    console.log("- Block: " + block);
                }
                if (receipt.success === false) {
                    console.log("⚠️  UserOp execution reverted on-chain");
                }
            } else {
                console.log("⚠️  Timed out waiting for receipt. The tx may still be pending.");
            }

            return { success: true, userOpHash, receipt };
        } catch (error) {
            console.error("Failed to submit to bundler: " + error.message);
            return { success: false, error: error.message, userOp };
        }

    } catch (error) {
        console.error("Transaction failed: " + error.message);
        return { success: false, error: error.message };
    } finally {
        await pq.cleanup();
        await ecdsa.cleanup();
    }
}

// ─── UI Setup ───────────────────────────────────────────────────────────

function setup() {
    const button  = document.getElementById('sendTx');
    const output  = document.getElementById('output');
    const softSeedGroup  = document.getElementById('softSeedGroup');
    const ledgerInfoGroup = document.getElementById('ledgerInfoGroup');
    const signingModeRadios = document.getElementsByName('signingMode');

    if (!button || !output) { console.error('Missing UI elements'); return; }

    redirectConsole(output);

    function updateSeedVisibility() {
        const mode = document.querySelector('input[name="signingMode"]:checked').value;
        if (softSeedGroup)   softSeedGroup.style.display  = (mode === 'soft') ? '' : 'none';
        if (ledgerInfoGroup) ledgerInfoGroup.style.display = (mode === 'ledger') ? '' : 'none';
    }
    signingModeRadios.forEach(r => r.addEventListener('change', updateSeedVisibility));
    updateSeedVisibility();

    // Disable Ledger radio when Falcon is selected
    const pqAlgoSelect = document.getElementById('pqAlgo');
    const ledgerRadio  = document.getElementById('modeLedger');
    if (pqAlgoSelect && ledgerRadio) {
        pqAlgoSelect.addEventListener('change', () => {
            const isFalcon = pqAlgoSelect.value === 'falcon';
            ledgerRadio.disabled = isFalcon;
            if (isFalcon && ledgerRadio.checked) {
                document.getElementById('modeSoft').checked = true;
                updateSeedVisibility();
            }
        });
    }

    output.textContent = '✅ Ready to send a transaction.\nChoose your signing mode and fill in the details above.\n';

    button.addEventListener('click', async () => {
        button.disabled = true;
        output.textContent = '';

        try {
            const rpcUrl = document.getElementById('rpcUrl')?.value.trim();
            if (!rpcUrl) { console.log('❌ Please enter an RPC URL.'); return; }

            console.log('🔌 Connecting to RPC: ' + rpcUrl);
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const network = await provider.getNetwork();
            console.log('✅ Connected to ' + network.name + ' (Chain ID: ' + network.chainId + ')');

            const signingMode = document.querySelector('input[name="signingMode"]:checked').value;
            const pqAlgo = document.getElementById('pqAlgo')?.value || 'mldsa';

            const preQuantumSeed = signingMode === 'ledger'
                ? ''
                : document.getElementById('preQuantumSeed').value.trim();

            const postQuantumSeed = document.getElementById('postQuantumSeed')?.value.trim() || '';
            const pimlicoApiKey   = document.getElementById('pimlicoApiKey').value.trim();
            const accountAddress  = document.getElementById('accountAddress').value.trim();
            const targetAddress   = document.getElementById('targetAddress').value.trim();
            const valueEth        = document.getElementById('value').value.trim();
            const callData        = document.getElementById('callData').value.trim();

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

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Poll the bundler for a UserOperation receipt until it is mined.
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
            if (result.result) return result.result;
        } catch (_) { /* network hiccup — keep polling */ }

        elapsed += intervalMs;
        if (elapsed % 15_000 === 0) {
            console.log("  ⏳ Still waiting... " + (elapsed / 1000) + "s elapsed");
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
}
