import type { Hash } from "viem";
import { Address } from "../../interfaces/types.interface";
import { SerializedUserOperation } from "../../interfaces/user-ops.interface";
import { WithdrawProveOutput } from "../../state/thunks/withdrawThunk";

/**
 * A fully built + signed paymaster withdrawal, ready to relay to the bundler.
 * The userOp is assembled in the prepare phase (`paymasterWithdrawThunk`), so
 * the broadcaster only forwards it.
 */
export interface IGenericPaymasterWithdrawalPayload {
  mode: "paymaster";
  proof: WithdrawProveOutput;
  poolAddress: Address;
  isERC20: boolean;
  /** Value withdrawn from the pool, before the sponsored gas fee. */
  withdrawnValue: bigint;
  /** Sponsored gas fee committed in the userOp, in the pool asset's base units. The recipient receives `withdrawnValue - fee`. */
  fee: bigint;
  paymasterAddress: `0x${string}`;
  entryPointAddress: `0x${string}`;
  bundlerUrl: string;
  userOperation: SerializedUserOperation;
  /**
   * Hash of `userOperation`, computed when it was signed. Absent in payloads
   * prepared by older SDK versions; the broadcaster then computes it.
   */
  userOpHash?: Hash;
}

export interface PaymasterConfirmation {
  /** The mined bundle transaction hash from the userOp receipt. */
  txHash: Hash;
}

export interface PaymasterBroadcastResult {
  /** Known as soon as the bundler accepts the userOp, before it is mined. */
  userOpHash: Hash;
  /**
   * Polls the bundler for the userOp receipt. Safe to call again after an
   * `unconfirmed` failure.
   *
   * @throws {PaymasterBroadcastError} If the userOp reverted or could not be confirmed.
   */
  wait(): Promise<PaymasterConfirmation>;
}

export interface IPaymasterBroadcasterClient {
  /**
   * Resolves once the bundler accepts every userOp, with one result per
   * withdrawal in the same order.
   *
   * @throws {PaymasterBroadcastError} With the first withdrawal the bundler did not accept.
   */
  broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]>;
}

/**
 * - `not-accepted`: the bundler answered the send request with an error and
 *   does not have the userOp, so it will not land. A bundler answer that it
 *   already has this userOp counts as accepted.
 * - `reverted`: the userOp was mined with `success: false`. Notes spent before
 *   the revert stay spent, and their funds may be held by the userOp sender.
 * - `unconfirmed`: the outcome is unknown, the userOp may still land. Thrown by
 *   `broadcast()` when the send request failed without an answer from the
 *   bundler, e.g. a timeout, and the bundler does not know the userOp yet.
 */
export type PaymasterBroadcastFailure = "not-accepted" | "reverted" | "unconfirmed";

/**
 * A sender nonce that moved after the withdrawal was prepared: its EntryPoint
 * nonce, or the transaction count its EIP-7702 authorization was signed for.
 * The withdrawal cannot land as signed; another operation from the sender may
 * have spent its notes, so confirm earlier outcomes and sync before preparing
 * another withdrawal.
 */
export interface StaleSenderNonce {
  kind: "entry-point" | "authorization";
  signed: bigint;
  current: bigint;
}

/** Its message is safe to report: it never includes the signed userOp. */
export class PaymasterBroadcastError extends Error {
  readonly userOpHash?: Hash;
  readonly txHash?: Hash;
  /** Set on `not-accepted` when the bundler refused it because a sender nonce moved. */
  readonly staleNonce?: StaleSenderNonce;

  constructor(
    readonly failure: PaymasterBroadcastFailure,
    message: string,
    { userOpHash, txHash, staleNonce }: { userOpHash?: Hash; txHash?: Hash; staleNonce?: StaleSenderNonce } = {},
  ) {
    super(message);
    this.name = "PaymasterBroadcastError";
    this.userOpHash = userOpHash;
    this.txHash = txHash;
    this.staleNonce = staleNonce;
  }
}
