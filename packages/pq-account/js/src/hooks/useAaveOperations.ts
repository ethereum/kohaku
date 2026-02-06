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

type AaveOperationFn = (
  accountAddress: string,
  asset: string,
  amount: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: ReturnType<typeof walletClientToEthersProvider>,
  bundlerUrl: string,
  log: (msg: string) => void
) => Promise<unknown>;

const useAaveMutation = <TParams extends AaveOperationParams>(
  operationFn: (
    params: TParams,
    provider: ReturnType<typeof walletClientToEthersProvider>,
    log: (msg: string) => void
  ) => Promise<unknown>,
  invalidateKeys: string[][]
) => {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("aave");

  return useMutation({
    mutationFn: async (params: TParams) => {
      clear();

      validateSeed(params.preQuantumSeed, "Pre-quantum seed");
      validateSeed(params.postQuantumSeed, "Post-quantum seed");

      if (!params.bundlerUrl) {
        log("⚠️ No Bundler URL provided. Running in DRY-RUN mode.");
      }

      if (!params.accountAddress) {
        throw new Error("Please enter an account address");
      }

      if (!walletClient) {
        throw new Error("Wallet not connected");
      }

      log("🔌 Connecting to wallet...");
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log(`✅ Connected to ${network.name}`);
      log("");

      return operationFn(params, provider, log);
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error) => {
      log("❌ Error: " + (error as Error).message);
    },
  });
};

const INVALID_AMOUNT_MSG = "Please enter a valid amount";

const makeStandardOperation =
  (fn: AaveOperationFn) =>
  (
    params: AaveOperationParams,
    provider: ReturnType<typeof walletClientToEthersProvider>,
    log: (msg: string) => void
  ) =>
    fn(
      params.accountAddress,
      params.asset,
      params.amount,
      params.preQuantumSeed,
      params.postQuantumSeed,
      provider,
      params.bundlerUrl,
      log
    );

export const useAaveSupply = () =>
  useAaveMutation<AaveOperationParams>(
    (params, provider, log) => {
      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(INVALID_AMOUNT_MSG);
      }

      return makeStandardOperation(supplyToAave)(params, provider, log);
    },
    [["aavePosition"], ["balance"]]
  );

export const useAaveBorrow = () =>
  useAaveMutation<AaveOperationParams>(
    (params, provider, log) => {
      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(INVALID_AMOUNT_MSG);
      }

      return makeStandardOperation(borrowFromAave)(params, provider, log);
    },
    [["aavePosition"], ["balance"]]
  );

export const useAaveRepay = () =>
  useAaveMutation<AaveOperationParams>(
    (params, provider, log) => {
      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(INVALID_AMOUNT_MSG);
      }

      return makeStandardOperation(repayToAave)(params, provider, log);
    },
    [["aavePosition"], ["balance"]]
  );

export const useAaveWithdraw = () =>
  useAaveMutation<AaveOperationParams>(
    (params, provider, log) => {
      if (!params.amount || Number(params.amount) <= 0) {
        throw new Error(INVALID_AMOUNT_MSG);
      }

      return makeStandardOperation(withdrawFromAave)(params, provider, log);
    },
    [["aavePosition"], ["balance"]]
  );

export const useTokenApproval = () =>
  useAaveMutation<ApprovalParams>(
    (params, provider, log) =>
      approveTokenForAave(
        params.accountAddress,
        params.asset,
        params.approvalType,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      ),
    [["allowance"]]
  );
