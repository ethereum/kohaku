import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";

import { deployERC4337Account, validateSeed } from "../utils/createAccount";
import { walletClientToEthersProvider } from "../utils/ethersAdapter";
import { useConsoleLog } from "./useConsole";

interface DeployParams {
  factoryAddress: string;
  preQuantumSeed: string;
  postQuantumSeed: string;
}

export function useDeployAccount() {
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { log, clear } = useConsoleLog("create");

  return useMutation({
    mutationFn: async ({
      factoryAddress,
      preQuantumSeed,
      postQuantumSeed,
    }: DeployParams) => {
      clear();

      validateSeed(preQuantumSeed, "Pre-quantum seed");
      validateSeed(postQuantumSeed, "Post-quantum seed");

      if (
        !factoryAddress ||
        factoryAddress === "—" ||
        factoryAddress.includes("Not deployed")
      ) {
        throw new Error("Factory not available on this network");
      }

      if (!walletClient) {
        throw new Error("Wallet not connected");
      }

      const provider = walletClientToEthersProvider(walletClient);

      return deployERC4337Account(
        factoryAddress,
        preQuantumSeed,
        postQuantumSeed,
        provider,
        log
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
  });
}
