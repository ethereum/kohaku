import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { ethers, Signer } from "ethers";

import { hexToU8 } from "./hex.js";
import { to_expanded_encoded_bytes } from "./utils_mldsa.js";

const SEPARATOR =
  "============================================================";

const ACCOUNT_FACTORY_ABI = [
  "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
  "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address payable)",
];

export type DeploymentResult = {
  success: boolean;
  address?: string;
  transactionHash?: string;
  alreadyExists?: boolean;
  error?: string;
  gasUsed?: string;
  actualCost?: string;
};

export const validateSeed = (seed: string, name: string): void => {
  if (!seed.startsWith("0x")) {
    throw new Error(`${name} must start with "0x"`);
  }

  if (seed.length !== 66) {
    throw new Error(`${name} must be 32 bytes`);
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error(`${name} contains invalid hex`);
  }
};

export const getPublicKeys = (
  preQuantumSeed: string,
  postQuantumSeed: string
) => {
  const preQuantumPubKey = new ethers.Wallet(preQuantumSeed).address;
  const { publicKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed, 32));
  const postQuantumPubKey = to_expanded_encoded_bytes(publicKey);

  return { preQuantumPubKey, postQuantumPubKey };
};

export const deployERC4337Account = async (
  factoryAddress: string,
  preQuantumPubKey: string,
  postQuantumPubKey: string,
  signer: Signer,
  log: (msg: string) => void
): Promise<DeploymentResult> => {
  try {
    const { provider } = signer;

    if (!provider) throw new Error("Signer must have a provider");

    log("🔌 Connecting to wallet...");

    const address = await signer.getAddress();
    const balance = await provider.getBalance(address);
    const network = await provider.getNetwork();

    log("✅ Wallet connected");
    log("   Address: " + address);
    log("   Balance: " + ethers.formatEther(balance) + " ETH");
    log("   Network: " + network.name + " (Chain ID: " + network.chainId + ")");
    log("");

    log("📦 Deploying ERC4337 Account...");

    // Verify factory contract exists
    const factoryCode = await provider.getCode(factoryAddress);

    if (factoryCode === "0x") {
      throw new Error("No contract deployed at factory address!");
    }

    const factory = new ethers.Contract(
      factoryAddress,
      ACCOUNT_FACTORY_ABI,
      signer
    );

    // Get expected address
    const iface = new ethers.Interface(ACCOUNT_FACTORY_ABI);
    const callData = iface.encodeFunctionData("getAddress", [
      preQuantumPubKey,
      postQuantumPubKey,
    ]);
    const result = await provider.call({ to: factoryAddress, data: callData });
    const [expectedAddress] = iface.decodeFunctionResult("getAddress", result);

    if (!ethers.isAddress(expectedAddress)) {
      throw new Error("Invalid address returned from getAddress()");
    }

    log("📍 Expected account address: " + expectedAddress);

    // Check if exists
    const code = await provider.getCode(expectedAddress);

    if (code !== "0x") {
      log("");
      log(SEPARATOR);
      log("✅ ACCOUNT ALREADY EXISTS");
      log(SEPARATOR);
      log("🔐 ERC4337 Account: " + expectedAddress);
      log(SEPARATOR);

      return {
        success: true,
        address: expectedAddress,
        alreadyExists: true,
      };
    }

    // Estimate and deploy
    log("");
    log("⛽ Estimating gas...");

    let estimatedGas;

    try {
      estimatedGas = await factory.createAccount.estimateGas(
        preQuantumPubKey,
        postQuantumPubKey
      );
      log("   Estimated: " + estimatedGas.toString());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      log("⚠️  Gas estimation failed: " + error.message);
      estimatedGas = 5000000n;
      log("   Using default gas limit: " + estimatedGas.toString());
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    const gasCostWei = estimatedGas * gasPrice;

    log("   Gas price: " + ethers.formatUnits(gasPrice, "gwei") + " gwei");
    log("   Estimated cost: " + ethers.formatEther(gasCostWei) + " ETH");
    log("");
    log("🚀 Creating account...");
    log("⏳ Please confirm in your wallet...");

    const tx = await factory.createAccount(
      preQuantumPubKey,
      postQuantumPubKey,
      {
        gasLimit: (estimatedGas * 120n) / 100n,
      }
    );

    log("✅ Transaction signed: " + tx.hash);
    log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();

    const actualCost = receipt!.gasUsed * (receipt!.gasPrice ?? 0n);

    log("");
    log(SEPARATOR);
    log("🎉 DEPLOYMENT COMPLETE!");
    log(SEPARATOR);
    log("🔐 ERC4337 Account: " + expectedAddress);
    log("📝 Transaction: " + tx.hash);
    log("⛽ Gas used: " + receipt!.gasUsed.toString());
    log("💸 Actual cost: " + ethers.formatEther(actualCost) + " ETH");
    log(SEPARATOR);

    return {
      success: true,
      address: expectedAddress,
      transactionHash: tx.hash,
      gasUsed: receipt!.gasUsed.toString(),
      actualCost: ethers.formatEther(actualCost),
    };
  } catch (e) {
    const error = e as { message: string; code?: string | number };

    log("❌ " + error.message);

    if (error.code === "ACTION_REJECTED" || error.code === 4001) {
      log("(User rejected the transaction)");
    }

    return {
      success: false,
      error: error.message,
    };
  }
};
