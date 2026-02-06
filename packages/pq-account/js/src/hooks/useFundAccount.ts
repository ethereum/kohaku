import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, isAddress, parseEther } from "viem";
import {
  usePublicClient,
  useSendTransaction as useWagmiSendTransaction,
} from "wagmi";

import { useConsoleLog } from "./useConsole";

type FundParams = {
  address: string;
  amount: string;
};

export const useFundAccount = () => {
  const queryClient = useQueryClient();
  const { mutateAsync: sendTransactionAsync } = useWagmiSendTransaction();
  const publicClient = usePublicClient();
  const { log } = useConsoleLog("create");

  return useMutation({
    mutationFn: async ({ address, amount }: FundParams) => {
      if (!address)
        throw new Error("No account address! Deploy an account first.");

      if (!isAddress(address)) {
        throw new Error("Invalid Ethereum address: " + address);
      }

      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Invalid amount. Please enter a valid ETH amount.");
      }

      if (!publicClient) {
        throw new Error("Public client not initialized");
      }

      log("");
      log("💰 Sending ETH to new account...");

      const hash = await sendTransactionAsync({
        to: address as Address,
        value: parseEther(amount),
      });

      log("✅ Transaction signed: " + hash);
      log("⏳ Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      return { txHash: hash, address, amount, gasUsed: receipt.gasUsed };
    },
    onSuccess: (data) => {
      const sep = "=".repeat(60);

      log("");
      log(sep);
      log("🎉 FUNDING COMPLETE!");
      log(sep);
      log("📤 Sent: " + data.amount + " ETH");
      log("📍 To: " + data.address);
      log("📝 Tx: " + data.txHash);

      if (data.gasUsed) {
        log("⛽ Gas used: " + data.gasUsed.toString());
      }

      log(sep);

      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error: unknown) => {
      const err = error as { message: string; code?: string | number };

      log("❌ " + err.message);

      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        log("(User rejected the transaction)");
      }
    },
  });
};
