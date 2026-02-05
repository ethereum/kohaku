import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";

import {
  approveTokenForAave,
  borrowFromAave,
  repayToAave,
  supplyToAave,
  withdrawFromAave,
} from "../utils/aaveOperations";
import { validateSeed } from "../utils/createAccount";
import { walletClientToEthersProvider } from "../utils/ethersAdapter";
import { useConsoleLog } from "./useConsole";

const SEED_LABELS = {
  PRE_QUANTUM: "Pre-quantum seed",
  POST_QUANTUM: "Post-quantum seed",
} as const;

const ERROR_MESSAGES = {
  NO_BUNDLER: "No Bundler URL provided. Running in DRY-RUN mode.",
  NO_ACCOUNT: "Please enter an account address",
  INVALID_AMOUNT: "Please enter a valid amount",
  NO_WALLET: "Wallet not connected",
} as const;

const LOG_MESSAGES = {
  CONNECTING: "Connecting to wallet...",
  CONNECTED_PREFIX: "Connected to ",
} as const;

type AaveOperationParams = {
  accountAddress: string;
  asset: string;
  amount: string;
  preQuantumSeed: string;
  postQuantumSeed: string;
  bundlerUrl: string;
};

type ApprovalParams = AaveOperationParams & {
  approvalType: "unlimited" | "0" | string;
};

export const useAaveSupply = () => {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("aave");

  return useMutation({
    mutationFn: async (params: AaveOperationParams) => {
      clear();

      validateSeed(params.preQuantumSeed, SEED_LABELS.PRE_QUANTUM);
      validateSeed(params.postQuantumSeed, SEED_LABELS.POST_QUANTUM);

      if (!params.bundlerUrl) {
        log(`\u26a0\ufe0f ${ERROR_MESSAGES.NO_BUNDLER}`);
      }

      if (!params.accountAddress) {
        throw new Error(ERROR_MESSAGES.NO_ACCOUNT);
      }

      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(ERROR_MESSAGES.INVALID_AMOUNT);
      }

      if (!walletClient) {
        throw new Error(ERROR_MESSAGES.NO_WALLET);
      }

      log(`\ud83d\udd0c ${LOG_MESSAGES.CONNECTING}`);
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log(`\u2705 ${LOG_MESSAGES.CONNECTED_PREFIX}${network.name}`);
      log("");

      return supplyToAave(
        params.accountAddress,
        params.asset,
        params.amount,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aavePosition"] });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error) => {
      log("\u274c Error: " + (error as Error).message);
    },
  });
};

export const useAaveBorrow = () => {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("aave");

  return useMutation({
    mutationFn: async (params: AaveOperationParams) => {
      clear();

      validateSeed(params.preQuantumSeed, SEED_LABELS.PRE_QUANTUM);
      validateSeed(params.postQuantumSeed, SEED_LABELS.POST_QUANTUM);

      if (!params.bundlerUrl) {
        log(`\u26a0\ufe0f ${ERROR_MESSAGES.NO_BUNDLER}`);
      }

      if (!params.accountAddress) {
        throw new Error(ERROR_MESSAGES.NO_ACCOUNT);
      }

      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(ERROR_MESSAGES.INVALID_AMOUNT);
      }

      if (!walletClient) {
        throw new Error(ERROR_MESSAGES.NO_WALLET);
      }

      log(`\ud83d\udd0c ${LOG_MESSAGES.CONNECTING}`);
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log(`\u2705 ${LOG_MESSAGES.CONNECTED_PREFIX}${network.name}`);
      log("");

      return borrowFromAave(
        params.accountAddress,
        params.asset,
        params.amount,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aavePosition"] });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error) => {
      log("\u274c Error: " + (error as Error).message);
    },
  });
};

export const useAaveRepay = () => {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("aave");

  return useMutation({
    mutationFn: async (params: AaveOperationParams) => {
      clear();

      validateSeed(params.preQuantumSeed, SEED_LABELS.PRE_QUANTUM);
      validateSeed(params.postQuantumSeed, SEED_LABELS.POST_QUANTUM);

      if (!params.bundlerUrl) {
        log(`\u26a0\ufe0f ${ERROR_MESSAGES.NO_BUNDLER}`);
      }

      if (!params.accountAddress) {
        throw new Error(ERROR_MESSAGES.NO_ACCOUNT);
      }

      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(ERROR_MESSAGES.INVALID_AMOUNT);
      }

      if (!walletClient) {
        throw new Error(ERROR_MESSAGES.NO_WALLET);
      }

      log(`\ud83d\udd0c ${LOG_MESSAGES.CONNECTING}`);
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log(`\u2705 ${LOG_MESSAGES.CONNECTED_PREFIX}${network.name}`);
      log("");

      return repayToAave(
        params.accountAddress,
        params.asset,
        params.amount,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aavePosition"] });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error) => {
      log("\u274c Error: " + (error as Error).message);
    },
  });
};

export const useAaveWithdraw = () => {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("aave");

  return useMutation({
    mutationFn: async (params: AaveOperationParams) => {
      clear();

      validateSeed(params.preQuantumSeed, SEED_LABELS.PRE_QUANTUM);
      validateSeed(params.postQuantumSeed, SEED_LABELS.POST_QUANTUM);

      if (!params.bundlerUrl) {
        log(`\u26a0\ufe0f ${ERROR_MESSAGES.NO_BUNDLER}`);
      }

      if (!params.accountAddress) {
        throw new Error(ERROR_MESSAGES.NO_ACCOUNT);
      }

      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(ERROR_MESSAGES.INVALID_AMOUNT);
      }

      if (!walletClient) {
        throw new Error(ERROR_MESSAGES.NO_WALLET);
      }

      log(`\ud83d\udd0c ${LOG_MESSAGES.CONNECTING}`);
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log(`\u2705 ${LOG_MESSAGES.CONNECTED_PREFIX}${network.name}`);
      log("");

      return withdrawFromAave(
        params.accountAddress,
        params.asset,
        params.amount,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aavePosition"] });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error) => {
      log("\u274c Error: " + (error as Error).message);
    },
  });
};

export const useTokenApproval = () => {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("aave");

  return useMutation({
    mutationFn: async (params: ApprovalParams) => {
      clear();

      validateSeed(params.preQuantumSeed, SEED_LABELS.PRE_QUANTUM);
      validateSeed(params.postQuantumSeed, SEED_LABELS.POST_QUANTUM);

      if (!params.bundlerUrl) {
        log(`\u26a0\ufe0f ${ERROR_MESSAGES.NO_BUNDLER}`);
      }

      if (!params.accountAddress) {
        throw new Error(ERROR_MESSAGES.NO_ACCOUNT);
      }

      if (!walletClient) {
        throw new Error(ERROR_MESSAGES.NO_WALLET);
      }

      log(`\ud83d\udd0c ${LOG_MESSAGES.CONNECTING}`);
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log(`\u2705 ${LOG_MESSAGES.CONNECTED_PREFIX}${network.name}`);
      log("");

      return approveTokenForAave(
        params.accountAddress,
        params.asset,
        params.approvalType,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowance"] });
    },
    onError: (error) => {
      log("\u274c Error: " + (error as Error).message);
    },
  });
};
