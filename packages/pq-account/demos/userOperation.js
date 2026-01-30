import { ethers } from 'ethers';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

export const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ACCOUNT_ABI = [
    "function execute(address dest, uint256 value, bytes calldata func) external",
    "function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external",
    "function getNonce() external view returns (uint256)",
];

function packUint128(a, b) {
  return ethers.solidityPacked(
    ["uint128","uint128"],
    [a, b]
  );
}

function unpackUint128(packed) {
    const bytes = ethers.getBytes(packed);
    const first = BigInt('0x' + ethers.hexlify(bytes.slice(0, 16)).slice(2));
    const second = BigInt('0x' + ethers.hexlify(bytes.slice(16, 32)).slice(2));
    return [first, second];
}

/**
 * Create initial UserOperation structure (without signature)
 */
export async function createBaseUserOperation(
    accountAddress,
    targetAddress,
    value,
    callData,
    provider,
    bundlerUrl
) {
    const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);

    let nonce;
    try {
        nonce = await account.getNonce();
    } catch {
        nonce = 0n;
    }

    const executeCallData = account.interface.encodeFunctionData(
        "execute",
        [targetAddress, value, callData]
    );

    // Fetch suggested gas fees from bundler
    let maxPriority, maxFee;
    try {
        const gasResponse = await fetch(bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'pimlico_getUserOperationGasPrice',
                params: []
            })
        });
        const gasResult = await gasResponse.json();
        if (!gasResult.result){
            throw new Error("No gas price returned");
        }
        maxFee = BigInt(gasResult.result.standard.maxFeePerGas);
        maxPriority = BigInt(gasResult.result.standard.maxPriorityFeePerGas);
    } catch (e) {
        console.warn("⚠️ Failed to fetch gas price from bundler, using defaults:", e);
        console.log("⚠️ PimLico does not work, back to default values!")
        maxPriority = ethers.parseUnits("0.1", "gwei");
        maxFee = ethers.parseUnits("0.2", "gwei");
    }

    // Base UserOperation structure
    const baseUserOp = {
        sender: accountAddress,
        nonce: nonce,
        initCode: "0x",
        callData: executeCallData,
        accountGasLimits: packUint128(13_500_000n, 500_000n),  // Initial values for estimation
        preVerificationGas: 1_000_000n,
        gasFees: packUint128(maxPriority, maxFee),
        paymasterAndData: "0x",
        signature: "0x"  // Empty initially
    };
    return baseUserOp;
}

/**
 * Convert UserOp to bundler format
 */
export function userOpToBundlerFormat(userOp) {
    const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
    const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);

    return {
        sender: userOp.sender,
        nonce: '0x' + BigInt(userOp.nonce).toString(16),
        // initCode: userOp.initCode || "0x",
        callData: userOp.callData,
        // paymasterAndData: userOp.paymasterAndData || "0x",
        verificationGasLimit: '0x' + verificationGasLimit.toString(16),
        callGasLimit: '0x' + callGasLimit.toString(16),
        preVerificationGas: '0x' + BigInt(userOp.preVerificationGas).toString(16),
        maxFeePerGas: '0x' + maxFeePerGas.toString(16),
        maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
        signature: userOp.signature
    };
}

/**
 * Estimate gas for UserOperation (requires valid signature)
 */
export async function estimateUserOperationGas(
    userOp,
    bundlerUrl
) {
    const userOpForBundler = userOpToBundlerFormat(userOp);
    try {
        const response = await fetch(bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_estimateUserOperationGas',
                params: [userOpForBundler, ENTRY_POINT_ADDRESS]
            })
        });
        const result = await response.json();
        
        if (result.error) {
            console.error("Estimation error:", result.error);
            throw new Error(result.error.message || "Estimation failed");
        }
        
        if (!result.result){
            throw new Error("No estimate returned");
        }
        
        // Get estimates
        let verificationGasLimit = BigInt(result.result.verificationGasLimit);
        let callGasLimit = BigInt(result.result.callGasLimit);
        
        // CRITICAL: Enforce minimums for Arbitrum multisig
        const MIN_VERIFICATION = 13_500_000n;
        
        if (verificationGasLimit < MIN_VERIFICATION) {
            console.warn("⚠️ Verification estimate too low, using minimum:", MIN_VERIFICATION.toString());
            console.log("⚠️ Verification estimate too low, using minimum:", MIN_VERIFICATION.toString());
            verificationGasLimit = MIN_VERIFICATION;
        }
        // const MIN_CALL = 500_000n;        
        // if (callGasLimit < MIN_CALL) {
        //     console.warn("⚠️ Call gas estimate too low, using minimum:", MIN_CALL.toString());
        //     callGasLimit = MIN_CALL;
        // }
        // console.log("- Final callGasLimit:", callGasLimit.toString());
        
        return {
            verificationGasLimit,
            callGasLimit,
            preVerificationGas: BigInt(result.result.preVerificationGas || userOp.preVerificationGas)
        };
        
    } catch (e) {
        console.warn("⚠️ Bundler gas estimation failed, using defaults:", e.message);
        console.log("⚠️ eth_estimate does not work, back to default values");
        return {
            verificationGasLimit: 13_500_000n,
            callGasLimit: 500_000n,
            preVerificationGas: userOp.preVerificationGas
        };
    }
}

/**
 * Update UserOperation with gas estimates
 */
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

/**
 * Get the hash that needs to be signed
 */
export function getUserOpHash(userOp, entryPointAddress, chainId) {
    const initCodeHash = ethers.keccak256(userOp.initCode);
    const callDataHash = ethers.keccak256(userOp.callData);
    const paymasterHash = ethers.keccak256(userOp.paymasterAndData);
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const packedEncoded = abi.encode(
        [
            "address",
            "uint256",
            "bytes32",
            "bytes32",
            "bytes32",
            "uint256",
            "bytes32",
            "bytes32",
        ],
        [
            userOp.sender,
            userOp.nonce,
            initCodeHash,
            callDataHash,
            userOp.accountGasLimits,
            userOp.preVerificationGas,
            userOp.gasFees,
            paymasterHash,
        ]
    );

    const packedUserOp = ethers.keccak256(packedEncoded);
    const finalEncoded = abi.encode(
        ["bytes32", "address", "uint256"],
        [packedUserOp, entryPointAddress, chainId]
    );
    const userOpHash = ethers.keccak256(finalEncoded);
    return userOpHash;
}

/**
 * Sign a UserOperation with pre-quantum (ECDSA) key
 */
export async function signUserOpPreQuantum(userOp, entryPointAddress, chainId, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
    const signature = wallet.signingKey.sign(userOpHash).serialized;
    return signature;
}

/**
 * Sign a UserOperation with post-quantum (ML-DSA) key
 */
export async function signUserOpPostQuantum(userOp, entryPointAddress, chainId, mldsaSecretKey) {
    const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
    const userOpHashBytes = ethers.getBytes(userOpHash);
    const signature = ml_dsa44.sign(userOpHashBytes, mldsaSecretKey);
    const signatureHex = ethers.hexlify(signature);
    return signatureHex;
}

/**
 * Create hybrid signature (both pre-quantum and post-quantum)
 */
export async function signUserOpHybrid(
    userOp,
    entryPointAddress,
    chainId,
    preQuantumPrivateKey,
    postQuantumSecretKey
) {
    const preQuantumSig = await signUserOpPreQuantum(
        userOp,
        entryPointAddress,
        chainId,
        preQuantumPrivateKey
    );

    const postQuantumSig = await signUserOpPostQuantum(
        userOp,
        entryPointAddress,
        chainId,
        postQuantumSecretKey
    );
    
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const hybridSignature = abi.encode(
        ["bytes", "bytes"],
        [preQuantumSig, postQuantumSig]
    );
    return hybridSignature;
}

/**
 * Submit UserOperation to bundler (v0.7 format)
 */
export async function submitUserOperation(userOp, bundlerUrl, entryPointAddress) {
    const userOpForBundler = userOpToBundlerFormat(userOp);

    console.log("📤 Submitting UserOperation to bundler...");

    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendUserOperation',
            params: [
                userOpForBundler,
                entryPointAddress
            ]
        })
    });

    const result = await response.json();
    if (result.error) {
        throw new Error("❌ Failed to submit to bundler: " + (result.error.message || 'Unknown error'));
    }

    console.log("✅ UserOperation submitted successfully");
    return result.result; // UserOperation hash
}