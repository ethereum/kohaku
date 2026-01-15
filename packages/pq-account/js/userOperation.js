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
    provider,
    bundlerUrl      // new parameter for estimating
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
        if (!gasResult.result){
            throw new Error("No gas price returned");
        }
        maxFee = BigInt(gasResult.result.slow.maxFeePerGas);
        maxPriority = BigInt(gasResult.result.slow.maxPriorityFeePerGas);

        console.log("- Bundler suggested maxPriorityFeePerGas:", maxPriority.toString());
        console.log("- Bundler suggested maxFeePerGas:", maxFee.toString());
    } catch (e) {
        console.warn("⚠️ Failed to fetch gas price from bundler, using defaults:", e);
        console.log("Error during pimlico!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
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
        preVerificationGas: 8_000_000n,
        gasFees: packUint128(maxPriority, maxFee),
        paymasterAndData: "0x",
        signature: "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000411fd8fa56dd8fb99e6017fa02da16f433a40a2441db1027616f1c99e614f3b581296e43b6a19203387470b28d0b753323958e961251ddbc579fec8da194eb396e1b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000097478114028e61f91263291d8c2eab479d27b8e973ca958f09d39b82dd6d3d113b8b5cb11fa9132a50abac1cae6fc4f5f0ec2f2208b12ad218f294e3fc4de315129d7dd6ce87dbfede0c00ad4351869410c118fa4be2c316bb9c18cc527fa5806c53fec969872df0115d2a6dda59ed9afa77d67524e02d812a7e1c48720d18a7cd81ffe003a3af589df21fa8855b57922ec3dc330f5c430a77788abb45e66122292c6446bbe2ff20b7888cdfe57f99106a999f66e4f370d328447c774d347f24297260afca34d4435dfe393229c51bb88e331b8023c52e7d34ee29a4e50d2f88ce2009ae4d5ff96e378c9ce004e5af244fc6dd258d867755bc86fb13fae28ef3b3da95cd289b15a399655334277c05772bcea928376ca9f93bfe97a99720f99676364c92469a787cb5a9f58bc17ee2ee663420d8978a5e7503526d2c78db5814d8d3a88375de50e0ad7ade70ced6bf0ea4593a277d2458a4aa0532d151ccfbc77384dfaaa835ff2b15f12f97c7623e0d4027dadc1e85848bed8d6cd39b39dfd43f984062712eabb82ea575b4c19248d4956413e4e940ae949edad49af6f639e20dfad278eb1bbf3f8e2a84aefad37b270a279d44be6f260929e53a82a6a11e84697fe1cff42ea19e5ac7e30b0c7896ccaf998b2f6cd1fb72f7ee9506c73d71bbd7c600d7fee687d240704e352bd6f2ba04778027a89829c0cf3675e55163ed5a1770facdbd3f5b7d0383a61e815b4e67e493ab11da351fe276f4b7f5c5ca3974739378ff22434534b1df35c94a1df6be39051c70520ca140f7815a55ecbe8a7e21b004014a2f7d6470e3bc101c3fa4a6c71b541b21ce1de176a1ee4f393757d4d7989b66d69c0ca9198d6c228e7a565970a61093d1fee445a2b0960ceaa10544b300d20a38748b7db19d217de7339c3e2894d42dd8aa647c8192fce3085e67861fd364c842a481bc9ce71bfa34fef7d8e6f4e6feeca40c33095573bc6a481ff32e97ad843ef222a22f32e015690bdf69620755df1aa502886e6b69e79ca543548e6f32f53a9c0c9223068b6b25f690bad6fe6d72ffb773c8eb3542a490940ecc38964a9d533947bac5038096a92e9f89d5fc26e2a73d1117f4fd349055b9dde512f6243f8debde6e88a4c6595c384831d48d29b57e4b8fb7c84bd405a20f7c96ad6a7ffe06b598235314c7e88103abf0c6f81573d38d480312749c64ceef0f0856f115226f7505158c9c7686347596b11ab34c4d013c69fcf390e965d1583b832853cd670fe433f46f2d799ed42d9efa7bb8fc02aa12a32b444d432847de222ad1ef7e9db8da679d8682358bbf0901da1c219322b7a2acc2782cf4e7ebf95257e6acf69f1022f69bfb5fd4a63f23ea7a28ed0bf512befef972c439365e940e6e90db8a95862813be872c9e6fd7b08ebd920fa3c4e2c71c665bec8b43c7a9f6953ce7e0cc167104fa0b2f345aa757887a3715acc644f33c97e5d0f9f750cd55fdec20910bec6c0016d4fbea66e4eda53d093d678a1e5de954ebce8171aadc85f870f0777fc418c824e837b854d541608cdbaa614858621a47a4d9a2d20bce07902fab76e9d1dc6cdecfd6d7f83780114a28a1e3aa21205a030e9eef1c013d9442410188a575bd13a5e2cf5f7345254b825fd12c84d6cf3eeb9443c98c03a2217291cb23107484b1835a661c9a1b2959eeb1ebd9153ce089ae35e55450dd2894c64e99340fa10770bd7674b57e78f26b69529af0b2ebb1477c0580511fd0f5ec7162b7c7e13227869c57eab196076754097c62847912ebfdd9ad00c66f28ecbcb6216c8b20bb75f3e3d5a75d4b29954bae7e6ad3d00268482145d16e90eb73a43d0da75dfbdc0c0665c696af26be3efd80b6d79c261954e4318fe30e703646e628829fc5fcd77a298f047088f6ee699cc3160a64ad856c1a27ae9c27a838b6df110e776fc7b471a362d7587611424068995285153b5fce9bb977ba8a7de20e9418c646718d9f6f5755ccfc5cec90dee5850dbd43bfc23b0a39c49c8d0f9e95982c678b19312593a5f4a2e8d1e6f2ae4f870beaace6feef712a16fdcd697def9031facd33bf8b4821143659a0d332b4755d1ec5552b7c9e5551904f465046c7f18b2bf0ff89208640a95bc614a53d8e20c530d0e8726a626764356b2eb4ac130c5496ce31a31f44d8f12bd04e0e03ed7f7432821a4479a16e1bc5f0de1b79c6888fe1b5c6f673c2e79894d0cfa6bad8c8e178467eff3a7024913b6e3cf75bfc2832cf93efe4d9ff61d8161e1ac5aa62853516a09f6b086232f6647dfba4f180b521aa9ae026aeee1b6ccf0a76c0df224101d6c0d945317fa635191a42c58aac3bbced1ba6dfa315d1f7b1e69febbd0422b1c1023608ce11b4fbd7f2714e2434ff54feea2ac95ccf9e72bf8ee54ce5a2e57bdacbf96c82c47f7aeb25ef9f240fd90e56a84fc1f947f99f0ceb7e627027c3d127318bf5bc2c37044f73cf167895753f5a96726afe661b7d5373c8e65d02b20ef3279b65d326eae482d5ba55989d7e7477d3c10e86e84fbf1bfc0920ce86cc578ea6380928a3c5af4949435c11696bf4d63e96dcc57cfd5c38c7c960b931eb35458f4e8350dcabd4df28903c38c6e47fe25c0c204240d60fed4cb25126db4d24ded2b95595b26d3615a5551771eb4d731a7ca2fd1827d86231dbf5dee480252e9fc12801cdef3609fc07e78492ba35037b1f60009006dfef469e63517e0cd6bec4ebb5532709c27b0ebc63a81ce72264e5ca3e09d8d7ffd854e0c903d5d066ad82101e576a08e07f5293fa360ec2fc2cf5308f867656e0d015f685d87156df3f5a6fc1ee37e5714d5aabb6178698e130d5116c6038d222e4f925e9383356ce6815c40fce6010489f4432c3e80c6d22160eecc0d69265dc26949581d2b68667b7417435a2906a9e964c880f357723bc6f5526a63aabd053ef13e54817384cdf3389915d66b9ae66b04aab058551934e5f6ffc708e3cc57200b1ea58596810a1deb66152718447cf6fbe09dcef7916d220f54e01966512d2ceab7328789fdd1750706fcb5ff7b1e86df9cc631a542332500ad2e335aef242854c100f6fc0316003aa43f05e8dde7c39fac9c63bdb2f7da64a2cf687c9a944168b0d3ee62af85f02ea9be2e104594e7de141488c9209685051181bb54052b8f4ac0ff8ce1e7eef8a5fdd1d83b4922d7b38d9f56f2da5a943303e65f4bbb49b2449b90b2daa7d2b8d74619479777188adfc6b084e68ac3ecf3c8522764a34957c6ea03b9516092f001b89049f19a84654f4513189a621bf15a49364348535e6c7c7ea3b4c2d2e3ee0e266b6c739ba0a2a6bdc0c1d808131c212836385158727fc0c6c81d3338434d52555d7e81919da4bacee0fd000000000000000000000000000000000000000000000e1b293a000000000000000000000000"
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
    console.log(userOpForBundler);

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
        if (!result.result){
            console.log("eth_estimateUserOperationGas not working!");
            throw new Error("No estimate returned");
        }
        
        // Update accountGasLimits based on result
        const verificationGasLimit = BigInt(result.result.verificationGasLimit);
        const callGasLimit = BigInt(result.result.callGasLimit);
        tempUserOp.accountGasLimits = packUint128(verificationGasLimit, callGasLimit);

    } catch (e) {
        console.warn("⚠️ Bundler gas estimation failed, using defaults:", e);
        console.log("Error during eth_estimate !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
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
