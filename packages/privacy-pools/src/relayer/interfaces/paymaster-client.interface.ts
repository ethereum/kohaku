import type { Hash } from "viem";
import { Address } from "../../interfaces/types.interface";
import { SerializedUserOperation } from "../../interfaces/user-ops.interface";
import { WithdrawProveOutput } from "../../state/thunks/withdrawThunk";

/**
 * A fully built + signed paymaster withdrawal, ready to relay to the bundler.
 * The userOp is assembled in the prepare phase (`paymasterWithdrawThunk`), so
 * the broadcaster only forwards it and awaits the receipt.
 */
export interface IGenericPaymasterWithdrawalPayload {
  mode: "paymaster";
  proof: WithdrawProveOutput;
  poolAddress: Address;
  isERC20: boolean;
  paymasterAddress: `0x${string}`;
  entryPointAddress: `0x${string}`;
  bundlerUrl: string;
  userOperation: SerializedUserOperation;
}

export interface PaymasterBroadcastResult {
  userOpHash: Hash;
  /** The mined bundle transaction hash from the userOp receipt. */
  txHash: Hash;
}

export interface IPaymasterBroadcasterClient {
  broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]>;
}
