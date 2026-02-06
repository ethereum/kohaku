import { type Address, formatUnits, isAddress } from "viem";
import { useBalance, useReadContracts } from "wagmi";

import { ERC20_ABI } from "../config/aave";
import { getTokensForChain } from "../config/tokens";

export const useTokenBalances = (
  accountAddress: string | null,
  chainId: number | undefined
) => {
  const validAddress =
    accountAddress && isAddress(accountAddress)
      ? (accountAddress as Address)
      : undefined;

  const tokens = getTokensForChain(chainId);

  // Get native ETH balance
  const { data: ethBalance, refetch: refetchEth } = useBalance({
    address: validAddress,
    query: {
      enabled: !!validAddress,
    },
  });

  // Get ERC20 token balances
  const erc20Tokens = tokens.filter((t) => t.address !== null);
  const { data: erc20Balances, refetch: refetchErc20 } = useReadContracts({
    contracts: erc20Tokens.map((token) => ({
      address: token.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: validAddress ? [validAddress] : undefined,
    })),
    query: {
      enabled: !!validAddress && erc20Tokens.length > 0,
    },
  });

  const balances = tokens.map((token) => {
    if (token.address === null) {
      // Native ETH
      return {
        token,
        balance: ethBalance?.value ?? 0n,
        formatted: ethBalance
          ? parseFloat(formatUnits(ethBalance.value, 18)).toFixed(4)
          : "0",
      };
    } else {
      // ERC20 token
      const erc20Index = erc20Tokens.findIndex(
        (t) => t.symbol === token.symbol
      );
      const result = erc20Balances?.[erc20Index];
      const balance =
        result?.status === "success"
          ? BigInt(result.result as string | bigint)
          : 0n;

      return {
        token,
        balance,
        formatted: parseFloat(formatUnits(balance, token.decimals)).toFixed(4),
      };
    }
  });

  const refetch = async () => {
    await Promise.all([refetchEth(), refetchErc20()]);
  };

  return { balances, refetch };
};
