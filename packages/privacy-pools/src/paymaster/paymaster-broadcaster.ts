import type { Network } from '@kohaku-eth/plugins';
import { createPaymasterBundlerClient, sendSerializedUserOperation } from "./utils";
import {
  IGenericPaymasterWithdrawalPayload,
  IPaymasterBroadcasterClient,
  PaymasterBroadcastResult,
} from "../relayer/interfaces/paymaster-client.interface";

/**
 * Relays paymaster-sponsored withdrawals to the bundler. The userOps are fully
 * built and signed during the prepare phase (see `paymasterWithdrawThunk`), so
 * this client only forwards them and awaits their receipts.
 */
export class PaymasterBroadcaster implements IPaymasterBroadcasterClient {
  constructor(private readonly params: { network?: Network } = {}) {}
  async broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {
    const results = await Promise.allSettled(
      withdrawals.map((w) => PaymasterBroadcaster.broadcastOne(w, this.params.network)),
    );

    const failed = results.filter((r) => r.status === "rejected");

    if (failed.length > 0) {
      console.warn(
        `Some paymaster withdrawals failed.`,
        failed.map((e) => (e as PromiseRejectedResult).reason).join("\n"),
      );
    }

    return results
      .filter((r): r is PromiseFulfilledResult<PaymasterBroadcastResult> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  static async broadcastOne(
    withdrawal: IGenericPaymasterWithdrawalPayload,
    network?: Network,
  ): Promise<PaymasterBroadcastResult> {
    const { bundlerUrl, entryPointAddress, userOperation } = withdrawal;

    const bundlerClient = createPaymasterBundlerClient(bundlerUrl, network);
    const userOpHash = await sendSerializedUserOperation(
      bundlerClient,
      userOperation,
      entryPointAddress,
    );

    const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });

    return { userOpHash, txHash: receipt.transactionHash };
  }
}
