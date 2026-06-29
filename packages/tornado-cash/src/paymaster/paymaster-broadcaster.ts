import { type Hash } from 'viem';

import { EthereumProvider } from '@kohaku-eth/provider';
import { createPaymasterBundlerClient, sendSerializedUserOperation } from './utils';
import { IGenericPaymasterWithdrawalPayload, IPaymasterBroadcasterClient } from '../relayer/interfaces/paymaster-client.interface';
import { IPaymasterConfig } from '../plugin/interfaces/protocol-params.interface';

export interface PaymasterBroadcastResult {
  userOpHash: Hash;
}

/**
 * Relays paymaster-sponsored withdrawals to the bundler. The userOps are fully
 * built and signed during the prepare phase (see `paymasterWithdrawThunk`), so
 * this client only forwards them and awaits their receipts.
 */
export class PaymasterBroadcaster implements IPaymasterBroadcasterClient {

  async broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {
    // Group by sender: ops from the same sender carry sequential nonces and
    // must be submitted one-at-a-time (each must mine before the next is sent).
    // Ops from different senders can still run concurrently.
    const bySender = new Map<string, IGenericPaymasterWithdrawalPayload[]>();

    for (const w of withdrawals) {
      const key = w.userOperation.sender.toLowerCase();
      const group = bySender.get(key) ?? [];

      group.push(w);
      bySender.set(key, group);
    }

    const groupResults = await Promise.allSettled(
      [...bySender.values()].map(async (group) => {
        const out: PaymasterBroadcastResult[] = [];

        for (const w of group) {
          out.push(await PaymasterBroadcaster.broadcastOne(w));
        }

        return out;
      }),
    );

    const failed = groupResults.filter((r) => r.status === 'rejected');

    if (failed.length > 0) {
      console.warn(
        `Some paymaster withdrawals failed.`,
        failed.map((e) => e.reason).join('\n'),
      );
    }

    return groupResults
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value);
  }

  static async broadcastOne(
    withdrawal: IGenericPaymasterWithdrawalPayload,
  ): Promise<PaymasterBroadcastResult> {
    const { bundlerUrl, entryPointAddress, userOperation } = withdrawal;

    const bundlerClient = createPaymasterBundlerClient(bundlerUrl);
    const userOpHash = await sendSerializedUserOperation(bundlerClient, userOperation, entryPointAddress);

    await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });

    return { userOpHash };
  }
}
