import { ethers } from 'ethers';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

export const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ACCOUNT_ABI = [
    "function execute(address dest, uint256 value, bytes calldata func) external",
    "function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external",
    "function getNonce() external view returns (uint256)",
];

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

function packUint128(a, b) {
  return ethers.solidityPacked(
    ["uint128","uint128"],
    [a, b]
  );
}

/**
 * Create a UserOperation for ERC4337 account
 */
/**
 * Create a UserOperation for ERC4337 account
 */
export async function createUserOperation(
    accountAddress,
    targetAddress,
    value,
    callData,
    provider,
    bundlerUrl,      // new parameter for estimating
    chainId          // needed for creating temporary userOp hash
) {
    console.log("📝 Creating UserOperation (Packed v0.7)...");

    const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);

    let nonce;
    try {
        nonce = await account.getNonce();
        console.log("- Nonce:", nonce.toString());
    } catch {
        nonce = 0n;
    }

    const executeCallData = account.interface.encodeFunctionData(
        "execute",
        [targetAddress, value, callData]
    );
    console.log("- Execute call data:", executeCallData.slice(0, 20) + "...");

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
                params: []  // no params needed
            })
        });
        const gasResult = await gasResponse.json();
        if (!gasResult.result) throw new Error("No gas price returned");

        // result: { maxFeePerGas: "0x...", maxPriorityFeePerGas: "0x..." }
        maxFee = BigInt(gasResult.result.maxFeePerGas);
        maxPriority = BigInt(gasResult.result.maxPriorityFeePerGas);

        console.log("- Bundler suggested maxPriorityFeePerGas:", maxPriority.toString());
        console.log("- Bundler suggested maxFeePerGas:", maxFee.toString());
    } catch (e) {
        console.warn("⚠️ Failed to fetch gas price from bundler, using defaults:", e);
        maxPriority = ethers.parseUnits("0.1", "gwei");
        maxFee = ethers.parseUnits("0.2", "gwei");
    }

    // temporary UserOperation for gas estimation
    let tempUserOp = {
        sender: accountAddress,
        nonce: nonce,
        initCode: "0x",
        callData: executeCallData,
        accountGasLimits: packUint128(0n, 0n), // placeholder
        preVerificationGas: 310_000n,
        gasFees: packUint128(maxPriority, maxFee),
        paymasterAndData: "0x",
        signature: "0x"
    };

    // Prepare for bundler
    function unpackUint128(packed) {
        const bytes = ethers.getBytes(packed);
        const first = BigInt('0x' + ethers.hexlify(bytes.slice(0, 16)).slice(2));
        const second = BigInt('0x' + ethers.hexlify(bytes.slice(16, 32)).slice(2));
        return [first, second];
    }

    const [dummyVerification, dummyCall] = unpackUint128(tempUserOp.accountGasLimits);
    const userOpForBundler = {
        sender: tempUserOp.sender,
        nonce: '0x' + BigInt(tempUserOp.nonce).toString(16),
        callData: tempUserOp.callData,
        verificationGasLimit: '0x' + dummyVerification.toString(16),
        callGasLimit: '0x' + dummyCall.toString(16),
        preVerificationGas: '0x' + BigInt(tempUserOp.preVerificationGas).toString(16),
        maxFeePerGas: '0x' + maxFee.toString(16),
        maxPriorityFeePerGas: '0x' + maxPriority.toString(16),
        signature: tempUserOp.signature
    };

    // Estimate gas via bundler
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
        if (!result.result) throw new Error("No estimate returned");
        
        console.log("- Gas estimate from bundler:", result.result);

        // Update accountGasLimits based on result
        const verificationGasLimit = BigInt(result.result.verificationGasLimit);
        const callGasLimit = BigInt(result.result.callGasLimit);
        tempUserOp.accountGasLimits = packUint128(verificationGasLimit, callGasLimit);

    } catch (e) {
        console.warn("⚠️ Bundler gas estimation failed, using defaults:", e);
        tempUserOp.accountGasLimits = packUint128(15_400_000n, 15_000n);
    }

    tempUserOp.gasFees = packUint128(maxPriority, maxFee);

    console.log("✅ Packed UserOperation created");

    return tempUserOp;
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
 * FIXED: Sign raw hash without Ethereum message prefix
 */
export async function signUserOpPreQuantum(userOp, entryPointAddress, chainId, privateKey) {
    console.log("🔏 Signing with pre-quantum key (ECDSA)...");
    const wallet = new ethers.Wallet(privateKey);
    const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
    const signature = wallet.signingKey.sign(userOpHash).serialized;
    return signature;
}

/**
 * Sign a UserOperation with post-quantum (ML-DSA) key
 */
export async function signUserOpPostQuantum(userOp, entryPointAddress, chainId, mldsaSecretKey) {
    console.log("🔐 Signing with post-quantum key (ML-DSA-44)...");
    const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
    const userOpHashBytes = ethers.getBytes(userOpHash);
    const signature = ml_dsa44.sign(userOpHashBytes, mldsaSecretKey); // , { extraEntropy: false });
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
    console.log("");
    console.log("✍️  Creating hybrid signature...");
    
    const preQuantumSig = await signUserOpPreQuantum(
        userOp,
        entryPointAddress,
        chainId,
        preQuantumPrivateKey
    );
    
    console.log("");
    const postQuantumSig = await signUserOpPostQuantum(
        userOp,
        entryPointAddress,
        chainId,
        postQuantumSecretKey
    );
    
    console.log("");
    console.log("🔗 Combining signatures...");
    
    // Combine signatures - encode as (preQuantumSig, postQuantumSig)
    // This matches the Solidity: abi.encode(preQuantumSig, postQuantumSig)
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const hybridSignature = abi.encode(
        ["bytes", "bytes"],
        [preQuantumSig, postQuantumSig]
    );
    
    console.log("- Hybrid signature length: " + hybridSignature.length + " chars");
    console.log("✅ Hybrid signature created");
    
    return hybridSignature;
}

/**
 * Submit UserOperation to bundler (v0.7 format)
 */
export async function submitUserOperation(userOp, bundlerUrl, entryPointAddress) {
    console.log("");
    console.log("📤 Submitting UserOperation to bundler...");
    console.log("- Bundler URL:", bundlerUrl);

    // Unpack 128-bit pairs
    function unpackUint128(packed) {
        const bytes = ethers.getBytes(packed);
        const first = BigInt('0x' + ethers.hexlify(bytes.slice(0, 16)).slice(2));
        const second = BigInt('0x' + ethers.hexlify(bytes.slice(16, 32)).slice(2));
        return [first, second];
    }

    // Before submitting:
    const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
    const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);

    const userOpForBundler = {
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

    console.log("Prepared UserOperation for bundler:", userOpForBundler);

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

    return result.result; // UserOperation hash
}
