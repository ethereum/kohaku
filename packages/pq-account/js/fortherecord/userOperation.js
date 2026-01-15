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

export function packUint128(a, b) {
  console.log("📦 packUint128 called with:", a.toString(), b.toString());
  const result = ethers.solidityPacked(
    ["uint128","uint128"],
    [a, b]
  );
  console.log("📦 packUint128 result:", result);
  return result;
}


export function unpackUint128(packed) {
  const bytes = ethers.getBytes(packed);
  
  // First 16 bytes = first uint128
  const firstBytes = bytes.slice(0, 16);
  const first = BigInt('0x' + ethers.hexlify(firstBytes).slice(2));
  
  // Last 16 bytes = second uint128
  const secondBytes = bytes.slice(16, 32);
  const second = BigInt('0x' + ethers.hexlify(secondBytes).slice(2));
  
  return [first, second];
}

/**
 * Get current gas prices from Pimlico bundler
 */
export async function getGasPrices(bundlerUrl, entryPointAddress) {
    console.log("💰 Fetching gas prices from bundler...");
    
    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'pimlico_getUserOperationGasPrice',
            params: []
        })
    });

    const result = await response.json();

    if (result.error) {
        throw new Error("Failed to get gas prices: " + (result.error.message || JSON.stringify(result.error)));
    }

    if (!result.result) {
        throw new Error("Bundler returned no gas price data");
    }

    const gasPrices = result.result;
    
    return {
        maxPriorityFeePerGas: BigInt(gasPrices.fast.maxPriorityFeePerGas),
        maxFeePerGas: BigInt(gasPrices.fast.maxFeePerGas)
    };
}

/**
 * Create a UserOperation for ERC4337 account
 */
export async function createUserOperation(
    accountAddress,
    targetAddress,
    value,
    callData,
    provider,
    entryPointAddress,
    bundlerUrl,
    gasPrices = null
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

    // Use provided gas prices or defaults
    let maxPriority, maxFee;
    if (gasPrices) {
        maxPriority = gasPrices.maxPriorityFeePerGas;
        maxFee = gasPrices.maxFeePerGas;
        console.log("✅ Using bundler gas prices:");
        console.log("   - Max Priority Fee: " + ethers.formatUnits(maxPriority, "gwei") + " gwei");
        console.log("   - Max Fee: " + ethers.formatUnits(maxFee, "gwei") + " gwei");
    } else {
        const feeData = await provider.getFeeData();
        maxPriority = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.0005", "gwei");
        maxFee = feeData.maxFeePerGas || ethers.parseUnits("0.0005", "gwei");
    }

    const verificationGasLimit0 = 15_275_000n;
    const callGasLimit0 = 15_000n;

    // dummy signature
    const dummyPreQuantumSig = '0x' + '00'.repeat(65);
    const dummyPostQuantumSig = '0x' + '00'.repeat(2420);
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const dummySignature = abi.encode(
        ["bytes", "bytes"],
        [dummyPreQuantumSig, dummyPostQuantumSig]
    );
    
    const userOp = {
        sender: accountAddress,
        nonce: nonce,
        initCode: "0x",
        callData: executeCallData,
        accountGasLimits: packUint128(
            verificationGasLimit0,
            callGasLimit0
        ),
        preVerificationGas: 85_000n,
        gasFees: packUint128(
            maxPriority,
            maxFee
        ),
        paymasterAndData: "0x",
        signature: dummySignature
    };

    // Estimate better gas limits
    const userOpForBundler0 = {
        sender: accountAddress,
        nonce: '0x' + BigInt(userOp.nonce).toString(16),
        callData: userOp.callData,
        verificationGasLimit: '0x' + verificationGasLimit0.toString(16),
        callGasLimit: '0x' + callGasLimit0.toString(16),
        preVerificationGas: '0x' + BigInt(userOp.preVerificationGas).toString(16),
        maxFeePerGas: '0x' + maxFee.toString(16),
        maxPriorityFeePerGas: '0x' + maxPriority.toString(16),
        signature: userOp.signature
    };
    console.log(userOpForBundler0);

    console.log("📊 Requesting gas estimation from bundler...");
    
    try {
        const response0 = await fetch(bundlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_estimateUserOperationGas',
                params: [
                    userOpForBundler0,
                    entryPointAddress
                ]
            })
        });

        // CRITICAL: Check response before parsing
        if (!response0.ok) {
            const errorText = await response0.text();
            console.error(`❌ HTTP ${response0.status}:`, errorText);
            throw new Error(`Bundler returned ${response0.status}: ${errorText}`);
        }

        const text = await response0.text();
        console.log("📥 Bundler response:", text);
        
        if (!text || text.trim() === '') {
            throw new Error("Empty response from bundler");
        }

        const result0 = JSON.parse(text);

        if (result0.error) {
            console.error("❌ Bundler error:", result0.error);
            throw new Error("Failed to estimate gas: " + (result0.error.message || JSON.stringify(result0.error)));
        }

        console.log("✅ Gas estimation successful");
        
        // Update the packed accountGasLimits with new estimates
        const newVerificationGas = BigInt(result0.result.verificationGasLimit);
        const newCallGas = BigInt(result0.result.callGasLimit);

        userOp.accountGasLimits = packUint128(newVerificationGas, newCallGas);
        
        if (result0.result.preVerificationGas) {
            userOp.preVerificationGas = BigInt(result0.result.preVerificationGas);
        }

    } catch (error) {
        console.error("❌ Gas estimation error:", error.message);
        console.log("⚠️  Using initial gas limits");
        // Continue with initial values
    }

    userOp.signature = "0x";  // Reset signature so it can be signed properly

    return userOp;
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
    const signature = ml_dsa44.sign(userOpHashBytes, mldsaSecretKey, { extraEntropy: false });
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

    const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
    const [maxPriority, maxFee] = unpackUint128(userOp.gasFees);
    
    const userOpForBundler = {
        sender: userOp.sender,
        nonce: '0x' + BigInt(userOp.nonce).toString(16),
        callData: userOp.callData,
        verificationGasLimit: '0x' + verificationGasLimit.toString(16),
        callGasLimit: '0x' + callGasLimit.toString(16),
        preVerificationGas: '0x' + BigInt(userOp.preVerificationGas).toString(16),
        maxFeePerGas: '0x' + maxFee.toString(16),
        maxPriorityFeePerGas: '0x' + maxPriority.toString(16),
        signature: userOp.signature
    };
    console.log(userOpForBundler);

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
