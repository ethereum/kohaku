import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { BrowserProvider, ethers } from "ethers";

import {
  createBaseUserOperation,
  ENTRY_POINT_ADDRESS,
  estimateUserOperationGas,
  signUserOpHybrid,
  submitUserOperation,
  updateUserOpWithGasEstimates,
  UserOperation,
} from "./userOperation";

const SEPARATOR =
  "============================================================";

function hexToU8(hex: string): Uint8Array {
  if (hex.startsWith("0x")) hex = hex.slice(2);

  return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

export interface SendTransactionResult {
  success: boolean;
  userOpHash?: string;
  userOp?: UserOperation;
  message?: string;
  error?: string;
}

export async function sendERC4337Transaction(
  accountAddress: string,
  targetAddress: string,
  valueEth: string,
  callData: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<SendTransactionResult> {
  try {
    const network = await provider.getNetwork();
    const value = ethers.parseEther(valueEth);
    const accountBalance = await provider.getBalance(accountAddress);

    log("📋 Transaction Details:");
    log("   From: " + accountAddress);
    log("   To: " + targetAddress);
    log("   Value: " + valueEth + " ETH");
    log("   Account Balance: " + ethers.formatEther(accountBalance) + " ETH");
    log("");

    if (accountBalance === 0n) {
      log("⚠️  WARNING: Account has no balance!");
      log("");
    }

    // Generate keys
    const { secretKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed));

    log("📝 Creating UserOperation...");

    let userOp = await createBaseUserOperation(
      accountAddress,
      targetAddress,
      value,
      callData,
      provider,
      bundlerUrl
    );

    log("✍️  Signing with hybrid scheme...");

    userOp.signature = await signUserOpHybrid(
      userOp,
      ENTRY_POINT_ADDRESS,
      network.chainId,
      preQuantumSeed,
      secretKey
    );

    if (!bundlerUrl) {
      log("");
      log(SEPARATOR);
      log("⚠️  DRY RUN (No Bundler URL)");
      log(SEPARATOR);
      log("✅ UserOperation signed successfully!");
      log("📝 InitCode: " + userOp.initCode);
      log("📝 CallData: " + userOp.callData);
      log(SEPARATOR);

      return {
        success: true,
        userOp,
        message: "Signed (Dry Run)",
      };
    }

    log("⛽ Estimating gas...");

    const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);

    userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);

    // Re-sign with final gas
    userOp.signature = await signUserOpHybrid(
      userOp,
      ENTRY_POINT_ADDRESS,
      network.chainId,
      preQuantumSeed,
      secretKey
    );

    log("📤 Submitting to bundler...");

    const userOpHash = await submitUserOperation(
      userOp,
      bundlerUrl,
      ENTRY_POINT_ADDRESS
    );

    log("");
    log(SEPARATOR);
    log("🎉 TRANSACTION SUBMITTED!");
    log(SEPARATOR);
    log("UserOp Hash: " + userOpHash);
    log(SEPARATOR);

    return {
      success: true,
      userOpHash,
      userOp,
    };
  } catch (e) {
    const error = e as { message: string };

    log("❌ " + error.message);

    return {
      success: false,
      error: error.message,
    };
  }
}
