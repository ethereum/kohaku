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
export async function createUserOperation(
    accountAddress,
    targetAddress,
    value,
    callData,
    provider
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

    // No inner call, just empty bytes
    const innerCallData = "0x";

    // Then encode the execute() call with the recipient (can be an EOA)
    const executeCallData = account.interface.encodeFunctionData(
        "execute",
        [targetAddress, 0, innerCallData]
    );

    console.log("- Execute call data:", executeCallData.slice(0, 20) + "...");

    // Use FIXED gas prices for reproducible hashes
    // These values are reasonable for Sepolia
    const maxPriority = ethers.parseUnits("1", "gwei");  // 1 gwei
    const maxFee = ethers.parseUnits("2", "gwei");       // 2 gwei
    
    console.log("- Using FIXED gas prices:");
    console.log("  maxPriorityFeePerGas:", ethers.formatUnits(maxPriority, "gwei"), "gwei");
    console.log("  maxFeePerGas:", ethers.formatUnits(maxFee, "gwei"), "gwei");

    const userOp = {
        sender: accountAddress,
        nonce: nonce,
        initCode: "0x",
        callData: executeCallData,

        // accountGasLimits = packUint128(verificationGasLimit, callGasLimit)
        // verificationGasLimit: HIGH (20M) - for expensive ML-DSA signature verification
        // callGasLimit: Lower (500k) - for simple contract call
        accountGasLimits: packUint128(
            20_000_000n,   // verificationGasLimit (first 128 bits)
            500_000n       // callGasLimit (second 128 bits)
        ),

        preVerificationGas: 100000n,

        // Solidity: bytes32(abi.encodePacked(uint128(maxPriorityFeePerGas), uint128(maxFeePerGas)))
        gasFees: packUint128(
            maxPriority,   // maxPriorityFeePerGas (first 128 bits)
            maxFee         // maxFeePerGas (second 128 bits)
        ),

        paymasterAndData: "0x",
        signature: "0x"
    };

    console.log("✅ Packed UserOperation created");

    return userOp;
}

/**
 * Get the hash that needs to be signed
 */
export function getUserOpHash(userOp, entryPointAddress, chainId) {
    console.log("🔢 Calculating UserOperation hash...");

    console.log("sender:", userOp.sender);
    console.log("nonce:", userOp.nonce.toString());

    const initCodeHash = ethers.keccak256(userOp.initCode);
    console.log("initCode hash:", initCodeHash);

    const callDataHash = ethers.keccak256(userOp.callData);
    console.log("callData hash:", callDataHash);

    console.log("accountGasLimits:", userOp.accountGasLimits);
    console.log("preVerificationGas:", userOp.preVerificationGas.toString());
    console.log("gasFees:", userOp.gasFees);

    const paymasterHash = ethers.keccak256(userOp.paymasterAndData);
    console.log("paymasterAndData hash:", paymasterHash);

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

    console.log("ABI encoded packedUserOp:", packedEncoded);

    const packedUserOp = ethers.keccak256(packedEncoded);
    console.log("packedUserOp hash:", packedUserOp);

    const finalEncoded = abi.encode(
        ["bytes32", "address", "uint256"],
        [packedUserOp, entryPointAddress, chainId]
    );

    console.log("Final ABI encoded:", finalEncoded);

    const userOpHash = ethers.keccak256(finalEncoded);

    console.log("✅ UserOp Hash:", userOpHash);
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
    
    console.log("- Pre-quantum signature: " + signature.slice(0, 20) + "...");
    console.log("- Signature length: " + signature.length + " chars");
    
    return signature;
}

/**
 * Sign a UserOperation with post-quantum (ML-DSA) key
 */
export async function signUserOpPostQuantum(userOp, entryPointAddress, chainId, mldsaSecretKey) {
    console.log("🔐 Signing with post-quantum key (ML-DSA-44)...");
    
    const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
    const userOpHashBytes = ethers.getBytes(userOpHash);
    
    // Sign with ML-DSA
    const signature = ml_dsa44.sign(userOpHashBytes, mldsaSecretKey);
    const signatureHex = ethers.hexlify(signature);
    
    console.log("- Post-quantum signature: " + signatureHex);
    console.log("- Signature length: " + signatureHex.length + " chars");
    
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

    console.log("✅ UserOperation submitted!");
    console.log("- UserOp Hash / Response:", result.result);

    return result.result; // UserOperation hash
}
