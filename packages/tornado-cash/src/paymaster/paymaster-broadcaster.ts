import { type Hash } from 'viem';

import { EthereumProvider } from '@kohaku-eth/provider';
import { BundlerClient } from './utils';
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
  // Kept for API compatibility; the userOps arrive fully built, so neither is used.
  constructor(
    _provider: EthereumProvider,
    _options: Record<number, IPaymasterConfig>,
  ) { }

  async broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {
    const results = await Promise.allSettled(
      withdrawals.map((w) => PaymasterBroadcaster.broadcastOne(w)),
    );

    const failed = results.filter((r) => r.status === 'rejected');

    if (failed.length > 0) {
      console.warn(
        `Some paymaster withdrawals failed.`,
        failed.map((e) => e.reason).join('\n'),
      );
    }

    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  static async broadcastOne(
    withdrawal: IGenericPaymasterWithdrawalPayload,
  ): Promise<PaymasterBroadcastResult> {
    const { bundlerUrl, entryPointAddress, userOperation } = withdrawal;

    const bundlerClient = new BundlerClient(bundlerUrl, entryPointAddress);
    const userOpHash = await bundlerClient.sendSerializedUserOperation(userOperation);

    await bundlerClient.waitForUserOperationReceipt(userOpHash);

    return { userOpHash };
  }
}
