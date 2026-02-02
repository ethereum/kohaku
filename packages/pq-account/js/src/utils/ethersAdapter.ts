import { BrowserProvider, type Eip1193Provider } from "ethers";
import type { WalletClient } from "viem";

/**
 * Convert a viem WalletClient to an ethers BrowserProvider.
 */
export function walletClientToEthersProvider(
  walletClient: WalletClient
): BrowserProvider {
  // Create an Eip1193 provider adapter from the wallet client
  const eip1193Provider: Eip1193Provider = {
    request: async (args: { method: string; params?: unknown[] }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return walletClient.request(args as any);
    },
  };

  return new BrowserProvider(eip1193Provider);
}
