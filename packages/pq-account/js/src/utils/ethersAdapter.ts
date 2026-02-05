import { BrowserProvider, type Eip1193Provider } from "ethers";
import type { WalletClient } from "viem";

export const walletClientToEthersProvider = (
  walletClient: WalletClient
): BrowserProvider => {
  const eip1193Provider: Eip1193Provider = {
    request: async (args: { method: string; params?: unknown[] }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return walletClient.request(args as any);
    },
  };

  return new BrowserProvider(eip1193Provider);
};
