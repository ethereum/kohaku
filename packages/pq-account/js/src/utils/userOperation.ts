import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { BrowserProvider, ethers } from "ethers";

export const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ACCOUNT_ABI = [
  "function execute(address dest, uint256 value, bytes calldata func) external",
  "function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external",
  "function getNonce() external view returns (uint256)",
];

export type UserOperation = {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
};

export type GasEstimates = {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
};

const packUint128 = (a: bigint, b: bigint): string => {
  return ethers.solidityPacked(["uint128", "uint128"], [a, b]);
};

const unpackUint128 = (packed: string): [bigint, bigint] => {
  const bytes = ethers.getBytes(packed);
  const first = BigInt("0x" + ethers.hexlify(bytes.slice(0, 16)).slice(2));
  const second = BigInt("0x" + ethers.hexlify(bytes.slice(16, 32)).slice(2));

  return [first, second];
};

export const createBaseUserOperation = async (
  accountAddress: string,
  targetAddress: string,
  value: bigint,
  callData: string,
  provider: BrowserProvider,
  bundlerUrl: string
): Promise<UserOperation> => {
  const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);

  let nonce: bigint;

  try {
    nonce = await account.getNonce();
  } catch {
    nonce = 0n;
  }

  const executeCallData = account.interface.encodeFunctionData("execute", [
    targetAddress,
    value,
    callData,
  ]);

  let maxPriority: bigint;
  let maxFee: bigint;

  try {
    const gasResponse = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "pimlico_getUserOperationGasPrice",
        params: [],
      }),
    });
    const gasResult = await gasResponse.json();

    if (!gasResult.result) {
      throw new Error("No gas price returned");
    }

    maxFee = BigInt(gasResult.result.standard.maxFeePerGas);
    maxPriority = BigInt(gasResult.result.standard.maxPriorityFeePerGas);
  } catch (e) {
    console.warn(
      "⚠️ Failed to fetch gas price from bundler, using defaults:",
      e
    );
    console.log("⚠️ PimLico does not work, back to default values!");
    maxPriority = ethers.parseUnits("0.1", "gwei");
    maxFee = ethers.parseUnits("0.2", "gwei");
  }

  const baseUserOp: UserOperation = {
    sender: accountAddress,
    nonce: nonce,
    initCode: "0x",
    callData: executeCallData,
    accountGasLimits: packUint128(13_500_000n, 500_000n),
    preVerificationGas: 1_000_000n,
    gasFees: packUint128(maxPriority, maxFee),
    paymasterAndData: "0x",
    signature: "0x",
  };

  return baseUserOp;
};

export const userOpToBundlerFormat = (userOp: UserOperation) => {
  const [verificationGasLimit, callGasLimit] = unpackUint128(
    userOp.accountGasLimits
  );
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);

  return {
    sender: userOp.sender,
    nonce: "0x" + BigInt(userOp.nonce).toString(16),
    callData: userOp.callData,
    verificationGasLimit: "0x" + verificationGasLimit.toString(16),
    callGasLimit: "0x" + callGasLimit.toString(16),
    preVerificationGas: "0x" + BigInt(userOp.preVerificationGas).toString(16),
    maxFeePerGas: "0x" + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
    signature: userOp.signature,
  };
};

export const estimateUserOperationGas = async (
  userOp: UserOperation,
  bundlerUrl: string
): Promise<GasEstimates> => {
  const userOpForBundler = userOpToBundlerFormat(userOp);

  try {
    const response = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_estimateUserOperationGas",
        params: [userOpForBundler, ENTRY_POINT_ADDRESS],
      }),
    });
    const result = await response.json();

    if (result.error) {
      console.error("Estimation error:", result.error);
      throw new Error(result.error.message || "Estimation failed");
    }

    if (!result.result) {
      throw new Error("No estimate returned");
    }

    let verificationGasLimit = BigInt(result.result.verificationGasLimit);
    const callGasLimit = BigInt(result.result.callGasLimit);

    const MIN_VERIFICATION = 13_500_000n;

    if (verificationGasLimit < MIN_VERIFICATION) {
      console.warn(
        "⚠️ Verification estimate too low, using minimum:",
        MIN_VERIFICATION.toString()
      );
      console.log(
        "⚠️ Verification estimate too low, using minimum:",
        MIN_VERIFICATION.toString()
      );
      verificationGasLimit = MIN_VERIFICATION;
    }

    return {
      verificationGasLimit,
      callGasLimit,
      preVerificationGas: BigInt(
        result.result.preVerificationGas || userOp.preVerificationGas
      ),
    };
  } catch (e) {
    console.warn(
      "⚠️ Bundler gas estimation failed, using defaults:",
      (e as Error).message
    );
    console.log("⚠️ eth_estimate does not work, back to default values");

    return {
      verificationGasLimit: 13_500_000n,
      callGasLimit: 500_000n,
      preVerificationGas: userOp.preVerificationGas,
    };
  }
};

export const updateUserOpWithGasEstimates = (
  userOp: UserOperation,
  gasEstimates: GasEstimates
): UserOperation => {
  return {
    ...userOp,
    accountGasLimits: packUint128(
      gasEstimates.verificationGasLimit,
      gasEstimates.callGasLimit
    ),
    preVerificationGas: gasEstimates.preVerificationGas,
  };
};

export const getUserOpHash = (
  userOp: UserOperation,
  entryPointAddress: string,
  chainId: bigint
): string => {
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
};

export const signUserOpPreQuantum = async (
  userOp: UserOperation,
  entryPointAddress: string,
  chainId: bigint,
  privateKey: string
): Promise<string> => {
  const wallet = new ethers.Wallet(privateKey);
  const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
  const signature = wallet.signingKey.sign(userOpHash).serialized;

  return signature;
};

export const signUserOpPostQuantum = async (
  userOp: UserOperation,
  entryPointAddress: string,
  chainId: bigint,
  mldsaSecretKey: Uint8Array
): Promise<string> => {
  const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);
  const userOpHashBytes = ethers.getBytes(userOpHash);
  const signature = ml_dsa44.sign(userOpHashBytes, mldsaSecretKey);
  const signatureHex = ethers.hexlify(signature);

  return signatureHex;
};

export const signUserOpHybrid = async (
  userOp: UserOperation,
  entryPointAddress: string,
  chainId: bigint,
  preQuantumPrivateKey: string,
  postQuantumSecretKey: Uint8Array
): Promise<string> => {
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
};

export const submitUserOperation = async (
  userOp: UserOperation,
  bundlerUrl: string,
  entryPointAddress: string
): Promise<string> => {
  const userOpForBundler = userOpToBundlerFormat(userOp);

  console.log("📤 Submitting UserOperation to bundler...");

  const response = await fetch(bundlerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendUserOperation",
      params: [userOpForBundler, entryPointAddress],
    }),
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(
      "❌ Failed to submit to bundler: " +
        (result.error.message || "Unknown error")
    );
  }

  console.log("✅ UserOperation submitted successfully");

  return result.result;
};
