import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";

import { walletClientToEthersProvider } from "../utils/ethersAdapter";
import { sendERC4337Transaction } from "../utils/sendTransaction";
import { useConsoleLog } from "./useConsole";

interface SendParams {
  accountAddress: string;
  targetAddress: string;
  sendValue: string;
  callData: string;
  preQuantumSeed: string;
  postQuantumSeed: string;
  bundlerUrl: string;
}

export function useSendTransaction() {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("send");

  return useMutation({
    mutationFn: async (params: SendParams) => {
      clear();

      if (!params.bundlerUrl) {
        log("⚠️ No Bundler URL provided. Running in DRY-RUN mode.");
      }

      if (!params.accountAddress || !params.targetAddress) {
        throw new Error("Please fill in account and recipient addresses");
      }

      if (!walletClient) {
        throw new Error("Wallet not connected");
      }

      log("🔌 Connecting to wallet...");
      const provider = walletClientToEthersProvider(walletClient);
      const network = await provider.getNetwork();

      log("✅ Connected to " + network.name);
      log("");

      return sendERC4337Transaction(
        params.accountAddress,
        params.targetAddress,
        params.sendValue,
        params.callData,
        params.preQuantumSeed,
        params.postQuantumSeed,
        provider,
        params.bundlerUrl,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error) => {
      log("❌ Error: " + (error as Error).message);
    },
  });
}
