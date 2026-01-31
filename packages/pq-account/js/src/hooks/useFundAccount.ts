import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { parseEther } from "viem";
import { useSendTransaction as useWagmiSendTransaction } from "wagmi";

interface FundParams {
  address: string;
  amount: string;
  log: (msg: string) => void;
}

export function useFundAccount() {
  const queryClient = useQueryClient();
  const { mutateAsync: sendTransactionAsync } = useWagmiSendTransaction();

  return useMutation({
    mutationFn: async ({ address, amount, log }: FundParams) => {
      if (!address)
        throw new Error("No account address! Deploy an account first.");

      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Invalid amount. Please enter a valid ETH amount.");
      }

      log("");
      log("💰 Sending ETH to new account...");

      const hash = await sendTransactionAsync({
        to: address as Address,
        value: parseEther(amount),
      });

      log("✅ Transaction signed: " + hash);
      log("⏳ Waiting for confirmation...");

      return { txHash: hash, address, amount };
    },
    onSuccess: (data, variables) => {
      variables.log("");
      variables.log(
        "============================================================"
      );
      variables.log("🎉 FUNDING COMPLETE!");
      variables.log(
        "============================================================"
      );
      variables.log("📤 Sent: " + data.amount + " ETH");
      variables.log("📍 To: " + data.address);
      variables.log("📝 Tx: " + data.txHash);
      variables.log(
        "============================================================"
      );

      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error: unknown, variables) => {
      const err = error as { message: string; code?: string | number };

      variables.log("❌ " + err.message);

      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        variables.log("(User rejected the transaction)");
      }
    },
  });
}
