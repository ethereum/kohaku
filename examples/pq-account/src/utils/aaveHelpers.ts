import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { BrowserProvider, isAddress } from "ethers";

import { AAVE_CONFIG, type AaveNetworkConfig } from "../config/aave";
import { hexToU8 } from "./hex.js";
import {
  createBaseUserOperation,
  ENTRY_POINT_ADDRESS,
  estimateUserOperationGas,
  signUserOpHybrid,
  submitUserOperation,
  updateUserOpWithGasEstimates,
  type UserOperation,
} from "./userOperation";

export const SEPARATOR =
  "============================================================";

export const ERRORS = {
  INVALID_ADDRESS: "Invalid account address",
  UNSUPPORTED_CHAIN: (chainId: number) =>
    `Aave not supported on chain ${chainId}`,
  UNSUPPORTED_TOKEN: (asset: string) =>
    `Token ${asset} not supported on this network`,
} as const;

export type AaveOperationResult = {
  success: boolean;
  userOpHash?: string;
  userOp?: UserOperation;
  message?: string;
  error?: string;
};

export const getValidatedConfig = (
  accountAddress: string,
  chainId: number
): AaveNetworkConfig => {
  if (!isAddress(accountAddress)) {
    throw new Error(ERRORS.INVALID_ADDRESS);
  }

  const config = AAVE_CONFIG[chainId] ?? null;

  if (!config) {
    throw new Error(ERRORS.UNSUPPORTED_CHAIN(chainId));
  }

  return config;
};

export const logSuccess = (
  result: AaveOperationResult,
  msg: string,
  log: (msg: string) => void
) => {
  if (result.success && result.userOpHash) {
    log(
      `\n${SEPARATOR}\n\ud83c\udf89 ${msg}\nUserOp Hash: ${result.userOpHash}\n${SEPARATOR}`
    );
  }
};

export const handleError = (
  e: unknown,
  log: (msg: string) => void
): AaveOperationResult => {
  const error = e as { message: string };

  log("\u274c " + error.message);

  return { success: false, error: error.message };
};

// Helper to execute an Aave operation via ERC4337
export const executeAaveUserOp = async (
  accountAddress: string,
  targetAddress: string,
  value: bigint,
  callData: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<AaveOperationResult> => {
  const network = await provider.getNetwork();
  const { secretKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed, 32));

  log("\ud83d\udcdd Creating UserOperation...");

  let userOp = await createBaseUserOperation(
    accountAddress,
    targetAddress,
    value,
    callData,
    provider,
    bundlerUrl
  );

  log("\u270d\ufe0f  Signing with hybrid scheme...");

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
    log("\u26a0\ufe0f  DRY RUN (No Bundler URL)");
    log(SEPARATOR);
    log("\u2705 UserOperation signed successfully!");
    log(SEPARATOR);

    return { success: true, userOp, message: "Signed (Dry Run)" };
  }

  log("\u26fd Estimating gas...");

  const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);

  userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);

  userOp.signature = await signUserOpHybrid(
    userOp,
    ENTRY_POINT_ADDRESS,
    network.chainId,
    preQuantumSeed,
    secretKey
  );

  log("\ud83d\udce4 Submitting to bundler...");

  const userOpHash = await submitUserOperation(
    userOp,
    bundlerUrl,
    ENTRY_POINT_ADDRESS
  );

  return { success: true, userOpHash, userOp };
};
