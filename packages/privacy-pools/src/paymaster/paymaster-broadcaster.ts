import type { Network } from '@kohaku-eth/plugins';
import { BaseError, type Hash } from "viem";
import type { BundlerClient } from "viem/account-abstraction";
import { createPaymasterBundlerClient, sendSerializedUserOperation } from "./utils";
import {
  IGenericPaymasterWithdrawalPayload,
  IPaymasterBroadcasterClient,
  PaymasterBroadcastError,
  PaymasterBroadcastResult,
  PaymasterConfirmation,
} from "../relayer/interfaces/paymaster-client.interface";

/**
 * viem error messages embed the request body, which here is the signed userOp,
 * and integrators forward errors to crash reporting. Only the short message and
 * the server-provided details are kept, and the original error is never attached
 * as a `cause`.
 */
const describeError = (error: unknown): string =>
  error instanceof BaseError
    ? [error.shortMessage, error.details].filter(Boolean).join(" ")
    : "Unknown error.";

const waitForConfirmation = async (
  bundlerClient: BundlerClient,
  userOpHash: Hash,
): Promise<PaymasterConfirmation> => {
  let userOpReceipt: Awaited<ReturnType<BundlerClient["waitForUserOperationReceipt"]>>;

  try {
    userOpReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  } catch (error) {
    throw new PaymasterBroadcastError(
      "unconfirmed",
      `Could not confirm userOp ${userOpHash}, it may still land: ${describeError(error)}`,
      { userOpHash },
    );
  }

  const txHash = userOpReceipt.receipt.transactionHash;

  if (!userOpReceipt.success) {
    const reason = userOpReceipt.reason ? `: ${userOpReceipt.reason}` : "";

    throw new PaymasterBroadcastError(
      "reverted",
      `UserOp ${userOpHash} reverted in transaction ${txHash}${reason}`,
      { userOpHash, txHash },
    );
  }

  return { txHash };
};

/**
 * Relays paymaster-sponsored withdrawals to the bundler. The userOps are fully
 * built and signed during the prepare phase (see `paymasterWithdrawThunk`), so
 * this client only forwards them and exposes a way to await their outcome.
 */
export class PaymasterBroadcaster implements IPaymasterBroadcasterClient {
  constructor(private readonly params: { network?: Network } = {}) {}

  async broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {
    return Promise.all(withdrawals.map((w) => PaymasterBroadcaster.broadcastOne(w, this.params.network)));
  }

  static async broadcastOne(
    { bundlerUrl, entryPointAddress, userOperation }: IGenericPaymasterWithdrawalPayload,
    network?: Network,
  ): Promise<PaymasterBroadcastResult> {
    const bundlerClient = createPaymasterBundlerClient(bundlerUrl, network);
    let userOpHash: Hash;

    try {
      userOpHash = await sendSerializedUserOperation(bundlerClient, userOperation, entryPointAddress);
    } catch (error) {
      throw new PaymasterBroadcastError(
        "not-accepted",
        `Bundler did not accept the userOp: ${describeError(error)}`,
      );
    }

    return { userOpHash, wait: () => waitForConfirmation(bundlerClient, userOpHash) };
  }
}
