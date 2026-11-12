import type { SignedAuthorization, Hash } from 'viem';
import { TornadoProveOutput } from '../../utils/tornado-prover';
import { Address } from '../../interfaces/types.interface';
import { PaymasterGasEstimation, SerializedUserOperation } from '../../interfaces/user-ops.interface';

export interface SignedDelegation {
  senderAddress: `0x${string}`;
  authorization: SignedAuthorization;
}

export interface IPaymasterWithdrawalPayload {
  mode: 'paymaster';
  proof: TornadoProveOutput;
  poolAddress: Address;
  isERC20: boolean;
  delegation?: SignedDelegation;
}

export interface IGenericPaymasterWithdrawalPayload {
  mode: 'paymaster';
  proof: TornadoProveOutput;
  poolAddress: Address;
  isERC20: boolean;
  paymasterAddress: `0x${string}`;
  entryPointAddress: `0x${string}`;
  bundlerUrl: string;
  // The fully built and signed userOp, produced in the prepare phase. The
  // broadcaster only relays it to the bundler.
  userOperation: SerializedUserOperation;
  /** Present in newly prepared payloads; absent in payloads from older SDKs. */
  gasEstimation?: PaymasterGasEstimation;
  /** Proof-bound fee in newly prepared payloads; optional for older stored operations. */
  fee?: bigint;
  /** Total note denominations spent by the operation, before the fee. */
  withdrawnValue?: bigint;
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
export type PaymasterBroadcastFailure = 'not-accepted' | 'reverted' | 'unconfirmed';

/** Its message is safe to report: it never includes the signed userOp. */
export class PaymasterBroadcastError extends Error {
  readonly userOpHash?: Hash;
  readonly txHash?: Hash;

  constructor(
    readonly failure: PaymasterBroadcastFailure,
    message: string,
    { userOpHash, txHash }: { userOpHash?: Hash; txHash?: Hash } = {},
  ) {
    super(message);
    this.name = 'PaymasterBroadcastError';
    this.userOpHash = userOpHash;
    this.txHash = txHash;
  }
}
