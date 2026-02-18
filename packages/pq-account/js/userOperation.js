import { ethers } from 'ethers';

export const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ACCOUNT_ABI = [
    "function execute(address dest, uint256 value, bytes calldata func) external",
    "function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external",
    "function getNonce() external view returns (uint256)",
];

function packUint128(a, b) {
  return ethers.solidityPacked(["uint128","uint128"], [a, b]);
}

function unpackUint128(packed) {
    const bytes = ethers.getBytes(packed);
    const first = BigInt('0x' + ethers.hexlify(bytes.slice(0, 16)).slice(2));
    const second = BigInt('0x' + ethers.hexlify(bytes.slice(16, 32)).slice(2));
    return [first, second];
}

// ─── UserOp creation ────────────────────────────────────────────────────

export async function createBaseUserOperation(
    accountAddress, targetAddress, value, callData, provider, bundlerUrl
) {
    const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);

    let nonce;
    try { nonce = await account.getNonce(); } catch { nonce = 0n; }

    const executeCallData = account.interface.encodeFunctionData(
        "execute", [targetAddress, value, callData]
    );

    let maxPriority, maxFee;
    try {
        const gasResponse = await fetch(bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'pimlico_getUserOperationGasPrice', params: []
            })
        });
        const gasResult = await gasResponse.json();
        if (!gasResult.result) throw new Error("No gas price returned");
        maxFee = BigInt(gasResult.result.standard.maxFeePerGas);
        maxPriority = BigInt(gasResult.result.standard.maxPriorityFeePerGas);
    } catch (e) {
        console.warn("⚠️ Failed to fetch gas price from bundler, using defaults:", e);
        maxPriority = ethers.parseUnits("0.1", "gwei");
        maxFee = ethers.parseUnits("0.2", "gwei");
    }

    return {
        sender: accountAddress,
        nonce,
        initCode: "0x",
        callData: executeCallData,
        accountGasLimits: packUint128(9_000_000n, 500_000n),
        preVerificationGas: 1_000_000n,
        gasFees: packUint128(maxPriority, maxFee),
        paymasterAndData: "0x",
        signature: "0x"
    };
}

// ─── Bundler format conversion ──────────────────────────────────────────

export function userOpToBundlerFormat(userOp) {
    const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
    const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);

    return {
        sender: userOp.sender,
        nonce: '0x' + BigInt(userOp.nonce).toString(16),
        callData: userOp.callData,
        verificationGasLimit: '0x' + verificationGasLimit.toString(16),
        callGasLimit: '0x' + callGasLimit.toString(16),
        preVerificationGas: '0x' + BigInt(userOp.preVerificationGas).toString(16),
        maxFeePerGas: '0x' + maxFeePerGas.toString(16),
        maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
        signature: userOp.signature
    };
}

// ─── Gas estimation ─────────────────────────────────────────────────────

export async function estimateUserOperationGas(userOp, bundlerUrl) {
    const userOpForBundler = userOpToBundlerFormat(userOp);
    try {
        const response = await fetch(bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'eth_estimateUserOperationGas',
                params: [userOpForBundler, ENTRY_POINT_ADDRESS]
            })
        });
        const result = await response.json();

        if (result.error) {
            console.error("Estimation error:", result.error);
            throw new Error(result.error.message || "Estimation failed");
        }
        if (!result.result) throw new Error("No estimate returned");

        let verificationGasLimit = BigInt(result.result.verificationGasLimit);
        let callGasLimit = BigInt(result.result.callGasLimit);
        let preVerificationGas = BigInt(result.result.preVerificationGas || userOp.preVerificationGas);

        const MIN_VERIFICATION = 9_000_000n;
        if (verificationGasLimit < MIN_VERIFICATION) {
            console.warn("⚠️ Verification estimate too low, using minimum:", MIN_VERIFICATION.toString());
            verificationGasLimit = MIN_VERIFICATION;
        }

        // The bundler underestimates preVerificationGas for large signatures.
        // The hybrid ML-DSA + ECDSA signature is ~2500 bytes of calldata,
        // far larger than a standard 65-byte ECDSA sig.
        // Apply a 4x multiplier with a minimum floor.
        const MIN_PRE_VERIFICATION = 800_000n;
        preVerificationGas = preVerificationGas * 4n;
        if (preVerificationGas < MIN_PRE_VERIFICATION) {
            preVerificationGas = MIN_PRE_VERIFICATION;
        }
        console.log("- preVerificationGas (adjusted for large signature): " + preVerificationGas.toString());

        return {
            verificationGasLimit,
            callGasLimit,
            preVerificationGas
        };
    } catch (e) {
        console.warn("⚠️ Bundler gas estimation failed, using defaults:", e.message);
        return {
            verificationGasLimit: 9_000_000n,
            callGasLimit: 500_000n,
            preVerificationGas: 1_000_000n
        };
    }
}

export function updateUserOpWithGasEstimates(userOp, gasEstimates) {
    return {
        ...userOp,
        accountGasLimits: packUint128(
            gasEstimates.verificationGasLimit,
            gasEstimates.callGasLimit
        ),
        preVerificationGas: gasEstimates.preVerificationGas
    };
}

// ─── Hashing ────────────────────────────────────────────────────────────

export function getUserOpHash(userOp, entryPointAddress, chainId) {
    const initCodeHash = ethers.keccak256(userOp.initCode);
    const callDataHash = ethers.keccak256(userOp.callData);
    const paymasterHash = ethers.keccak256(userOp.paymasterAndData);
    const abi = ethers.AbiCoder.defaultAbiCoder();

    const packedEncoded = abi.encode(
        ["address","uint256","bytes32","bytes32","bytes32","uint256","bytes32","bytes32"],
        [
            userOp.sender, userOp.nonce, initCodeHash, callDataHash,
            userOp.accountGasLimits, userOp.preVerificationGas,
            userOp.gasFees, paymasterHash,
        ]
    );

    const packedUserOp = ethers.keccak256(packedEncoded);
    const finalEncoded = abi.encode(
        ["bytes32", "address", "uint256"],
        [packedUserOp, entryPointAddress, chainId]
    );
    return ethers.keccak256(finalEncoded);
}

// ─── Signing ────────────────────────────────────────────────────────────

/**
 * Hybrid signature (ECDSA + ML-DSA).
 *
 * Both signers are injected — works for software or hardware.
 *
 * @param {object} ecdsaSigner - { signHash(Uint8Array) → {v, r, s} }
 * @param {object} mldsaSigner - { sign(Uint8Array) → Uint8Array }
 */
export async function signUserOpHybrid(
    userOp, entryPointAddress, chainId, ecdsaSigner, mldsaSigner
) {
    const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
    const userOpHashBytes = ethers.getBytes(userOpHash);

    // ML-DSA / Falcon
    const postQuantumSigBytes = await mldsaSigner.sign(userOpHashBytes);
    const postQuantumSig = ethers.hexlify(postQuantumSigBytes);

    // ECDSA
    const ecdsaResult = await ecdsaSigner.signHash(userOpHashBytes);
    const preQuantumSig = ecdsaResult.serialized;

    const abi = ethers.AbiCoder.defaultAbiCoder();
    return abi.encode(["bytes", "bytes"], [preQuantumSig, postQuantumSig]);
}

// ─── Submission ─────────────────────────────────────────────────────────

export async function submitUserOperation(userOp, bundlerUrl, entryPointAddress) {
    const userOpForBundler = userOpToBundlerFormat(userOp);

    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'eth_sendUserOperation',
            params: [userOpForBundler, entryPointAddress]
        })
    });

    const result = await response.json();
    if (result.error) {
        throw new Error("❌ Failed to submit to bundler: " + (result.error.message || 'Unknown error'));
    }

    return result.result;
}