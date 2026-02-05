import { type Address, formatEther, isAddress } from "viem";
import { useBalance } from "wagmi";

export const useAccountBalance = (address: string | null) => {
  const validAddress =
    address && isAddress(address) ? (address as Address) : undefined;

  const { data, isLoading, error } = useBalance({
    address: validAddress,
    query: {
      enabled: !!validAddress,
    },
  });

  const formatted = data ? `${formatEther(data.value).slice(0, 10)} ETH` : "—";

  return { data: formatted, isLoading, error };
};
