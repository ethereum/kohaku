import { BrowserProvider, ethers, Interface } from "ethers";
import { match } from "ts-pattern";

import {
  AAVE_POOL_ABI,
  ERC20_ABI,
  REFERRAL_CODE,
  VARIABLE_RATE_MODE,
  WETH_GATEWAY_ABI,
} from "../config/aave";
import {
  type AaveOperationResult,
  ERRORS,
  executeAaveUserOp,
  getValidatedConfig,
  handleError,
  logSuccess,
} from "./aaveHelpers";

export type { AaveOperationResult };

export const supplyToAave = async (
  accountAddress: string,
  asset: "ETH" | string,
  amount: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<AaveOperationResult> => {
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const config = getValidatedConfig(accountAddress, chainId);

    log("📥 Supplying to Aave V3...");
    log("");

    const { targetAddress, callData, value } = match(asset)
      .with("ETH", () => {
        const ethValue = ethers.parseEther(amount);
        const iface = new Interface(WETH_GATEWAY_ABI);

        log("📋 Supply Details:");
        log("   Asset: ETH (via WETH Gateway)");
        log("   Amount: " + amount + " ETH");

        return {
          targetAddress: config.wethGateway,
          callData: iface.encodeFunctionData("depositETH", [
            config.pool,
            accountAddress,
            REFERRAL_CODE,
          ]),
          value: ethValue,
        };
      })
      .otherwise(() => {
        const tokenInfo = config.tokens[asset];

        if (!tokenInfo) throw new Error(ERRORS.UNSUPPORTED_TOKEN(asset));

        const amountWei = ethers.parseUnits(amount, tokenInfo.decimals);
        const iface = new Interface(AAVE_POOL_ABI);

        log("📋 Supply Details:");
        log("   Asset: " + asset);
        log("   Amount: " + amount);
        log("   Token Address: " + tokenInfo.address);
        log("");
        log("⚠️  Note: ERC20 supply requires prior approval.");

        return {
          targetAddress: config.pool,
          callData: iface.encodeFunctionData("supply", [
            tokenInfo.address,
            amountWei,
            accountAddress,
            REFERRAL_CODE,
          ]),
          value: 0n,
        };
      });

    log("");

    const result = await executeAaveUserOp(
      accountAddress,
      targetAddress,
      value,
      callData,
      preQuantumSeed,
      postQuantumSeed,
      provider,
      bundlerUrl,
      log
    );

    logSuccess(
      result,
      `SUPPLY SUBMITTED! \ud83d\udce5 ${amount} ${asset} to Aave`,
      log
    );

    return result;
  } catch (e) {
    return handleError(e, log);
  }
};

// Borrow assets from Aave
export const borrowFromAave = async (
  accountAddress: string,
  asset: string,
  amount: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<AaveOperationResult> => {
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const config = getValidatedConfig(accountAddress, chainId);
    const tokenInfo = config.tokens[asset];

    if (!tokenInfo) throw new Error(ERRORS.UNSUPPORTED_TOKEN(asset));

    log("\ud83d\udcb8 Borrowing from Aave V3...");
    log("");

    const amountWei = ethers.parseUnits(amount, tokenInfo.decimals);
    const iface = new Interface(AAVE_POOL_ABI);
    const callData = iface.encodeFunctionData("borrow", [
      tokenInfo.address,
      amountWei,
      VARIABLE_RATE_MODE,
      REFERRAL_CODE,
      accountAddress,
    ]);

    log("\ud83d\udccb Borrow Details:");
    log("   Asset: " + asset);
    log("   Amount: " + amount);
    log("   Interest Mode: Variable");
    log("");

    const result = await executeAaveUserOp(
      accountAddress,
      config.pool,
      0n,
      callData,
      preQuantumSeed,
      postQuantumSeed,
      provider,
      bundlerUrl,
      log
    );

    logSuccess(
      result,
      `BORROW SUBMITTED! \ud83d\udcb8 ${amount} ${asset}`,
      log
    );

    return result;
  } catch (e) {
    return handleError(e, log);
  }
};

// Repay loan to Aave
export const repayToAave = async (
  accountAddress: string,
  asset: string,
  amount: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<AaveOperationResult> => {
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const config = getValidatedConfig(accountAddress, chainId);
    const tokenInfo = config.tokens[asset];

    if (!tokenInfo) throw new Error(ERRORS.UNSUPPORTED_TOKEN(asset));

    log("\ud83d\udcb3 Repaying loan to Aave V3...");
    log("");

    const amountWei = ethers.parseUnits(amount, tokenInfo.decimals);
    const iface = new Interface(AAVE_POOL_ABI);
    const callData = iface.encodeFunctionData("repay", [
      tokenInfo.address,
      amountWei,
      VARIABLE_RATE_MODE,
      accountAddress,
    ]);

    log("\ud83d\udccb Repay Details:");
    log("   Asset: " + asset);
    log("   Amount: " + amount);
    log("   Rate Mode: Variable");
    log("");
    log("\u26a0\ufe0f  Note: Repay requires prior approval of the Pool.");
    log("");

    const result = await executeAaveUserOp(
      accountAddress,
      config.pool,
      0n,
      callData,
      preQuantumSeed,
      postQuantumSeed,
      provider,
      bundlerUrl,
      log
    );

    logSuccess(result, `REPAY SUBMITTED! \ud83d\udcb3 ${amount} ${asset}`, log);

    return result;
  } catch (e) {
    return handleError(e, log);
  }
};

// Withdraw assets from Aave
export const withdrawFromAave = async (
  accountAddress: string,
  asset: "ETH" | string,
  amount: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<AaveOperationResult> => {
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const config = getValidatedConfig(accountAddress, chainId);

    log("📤 Withdrawing from Aave V3...");
    log("");

    const { targetAddress, callData } = match(asset)
      .with("ETH", () => {
        const amountWei = ethers.parseEther(amount);
        const iface = new Interface(WETH_GATEWAY_ABI);

        log("📋 Withdraw Details:");
        log("   Asset: ETH (via WETH Gateway)");
        log("   Amount: " + amount + " ETH");
        log("");
        log("⚠️  Note: Requires aWETH approval to WETH Gateway");

        return {
          targetAddress: config.wethGateway,
          callData: iface.encodeFunctionData("withdrawETH", [
            config.pool,
            amountWei,
            accountAddress,
          ]),
        };
      })
      .otherwise(() => {
        const tokenInfo = config.tokens[asset];

        if (!tokenInfo) throw new Error(ERRORS.UNSUPPORTED_TOKEN(asset));

        const amountWei = ethers.parseUnits(amount, tokenInfo.decimals);
        const iface = new Interface(AAVE_POOL_ABI);

        log("📋 Withdraw Details:");
        log("   Asset: " + asset);
        log("   Amount: " + amount);

        return {
          targetAddress: config.pool,
          callData: iface.encodeFunctionData("withdraw", [
            tokenInfo.address,
            amountWei,
            accountAddress,
          ]),
        };
      });

    log("");

    const result = await executeAaveUserOp(
      accountAddress,
      targetAddress,
      0n,
      callData,
      preQuantumSeed,
      postQuantumSeed,
      provider,
      bundlerUrl,
      log
    );

    logSuccess(
      result,
      `WITHDRAW SUBMITTED! \ud83d\udce4 ${amount} ${asset}`,
      log
    );

    return result;
  } catch (e) {
    return handleError(e, log);
  }
};

// Approve token for Aave Pool
export const approveTokenForAave = async (
  accountAddress: string,
  asset: string,
  amount: "unlimited" | "0" | string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<AaveOperationResult> => {
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const config = getValidatedConfig(accountAddress, chainId);
    const tokenInfo = config.tokens[asset];

    if (!tokenInfo) throw new Error(ERRORS.UNSUPPORTED_TOKEN(asset));

    log("\ud83d\udd13 Approving token for Aave Pool...");
    log("");

    const approvalAmount = match(amount)
      .with("unlimited", () => 2n ** 256n - 1n)
      .with("0", () => 0n)
      .otherwise((customAmount) =>
        ethers.parseUnits(customAmount, tokenInfo.decimals)
      );

    const iface = new Interface(ERC20_ABI);
    const callData = iface.encodeFunctionData("approve", [
      config.pool,
      approvalAmount,
    ]);

    log("\ud83d\udccb Approval Details:");
    log("   Token: " + asset);
    log("   Spender (Pool): " + config.pool);
    log("   Amount: " + (amount === "unlimited" ? "Unlimited" : amount));
    log("");

    const result = await executeAaveUserOp(
      accountAddress,
      tokenInfo.address,
      0n,
      callData,
      preQuantumSeed,
      postQuantumSeed,
      provider,
      bundlerUrl,
      log
    );

    logSuccess(
      result,
      `APPROVAL SUBMITTED! \u2705 ${asset} for Aave Pool`,
      log
    );

    return result;
  } catch (e) {
    return handleError(e, log);
  }
};
