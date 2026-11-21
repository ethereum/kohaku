import { createTx, TxData } from '@kohaku-eth/provider';
import { encodeFunctionData, erc20Abi } from 'viem';

/**
 * Tokens whose `approve` reverts when changing one nonzero allowance to another
 * (mainnet USDT). The SDK cannot read the depositor's current allowance, so
 * these get an `approve(spender, 0)` first; a leftover allowance, for example
 * from a deposit that reverted after its approval, would otherwise block the
 * next shield. Resetting is harmless for any other token.
 */
export const RESET_ALLOWANCE_TOKENS: ReadonlySet<string> = new Set([
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT (Ethereum mainnet)
]);

const approve = (tokenAddress: string, spender: string, amount: bigint): TxData =>
  createTx(tokenAddress, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender as `0x${string}`, amount] }));

/**
 * The approvals a deposit of `amount` needs: exactly `amount`, so the deposit
 * consumes the whole allowance, preceded by a reset for tokens that need it.
 */
export function approvalTxs(tokenAddress: string, spender: string, amount: bigint): TxData[] {
  const reset = RESET_ALLOWANCE_TOKENS.has(tokenAddress.toLowerCase()) ? [approve(tokenAddress, spender, 0n)] : [];

  return [...reset, approve(tokenAddress, spender, amount)];
}
