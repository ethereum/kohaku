import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";

import {
  AAVE_CONFIG,
  AAVE_POOL_ABI,
  type AavePosition,
  ERC20_ABI,
} from "../config/aave";

export const useAavePosition = (
  accountAddress: string | null,
  chainId: number | undefined
) => {
  const publicClient = usePublicClient();
  const config = chainId ? AAVE_CONFIG[chainId] ?? null : null;

  return useQuery({
    queryKey: ["aavePosition", accountAddress, chainId],
    queryFn: async (): Promise<AavePosition> => {
      if (!accountAddress || !config || !publicClient) {
        throw new Error("Missing account address or chain config");
      }

      const userData = await publicClient.readContract({
        address: config.pool,
        abi: AAVE_POOL_ABI,
        functionName: "getUserAccountData",
        args: [accountAddress as `0x${string}`],
      });

      const totalCollateralUSD = Number(userData[0]) / 1e8;
      const totalDebtUSD = Number(userData[1]) / 1e8;
      const availableBorrowsUSD = Number(userData[2]) / 1e8;
      const liquidationThreshold = Number(userData[3]) / 100;
      const ltv = Number(userData[4]) / 100;

      const MAX_UINT256 = 2n ** 256n - 1n;
      const healthFactor =
        userData[5] === MAX_UINT256
          ? ("Infinity" as const)
          : Number(userData[5]) / 1e18;

      const supplies: Array<{ symbol: string; amount: number }> = [];
      const borrows: Array<{ symbol: string; amount: number }> = [];

      for (const [symbol, tokenInfo] of Object.entries(config.tokens)) {
        try {
          const aTokenBalance = await publicClient.readContract({
            address: tokenInfo.aToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [accountAddress as `0x${string}`],
          });

          if (aTokenBalance > 0n) {
            supplies.push({
              symbol,
              amount: Number(formatUnits(aTokenBalance, tokenInfo.decimals)),
            });
          }
        } catch {
          // Token might not exist on this network
        }

        try {
          const debtTokenBalance = await publicClient.readContract({
            address: tokenInfo.debtToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [accountAddress as `0x${string}`],
          });

          if (debtTokenBalance > 0n) {
            borrows.push({
              symbol,
              amount: Number(formatUnits(debtTokenBalance, tokenInfo.decimals)),
            });
          }
        } catch {
          // Token might not exist on this network
        }
      }

      return {
        totalCollateralUSD,
        totalDebtUSD,
        availableBorrowsUSD,
        liquidationThreshold,
        ltv,
        healthFactor,
        supplies,
        borrows,
      };
    },
    enabled: !!accountAddress && !!config && !!publicClient,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Refetch every minute
  });
};
