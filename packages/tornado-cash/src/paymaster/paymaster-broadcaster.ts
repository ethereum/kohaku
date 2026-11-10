import type { Network } from '@kohaku-eth/plugins';
import type { Hash } from 'viem';
import type { BundlerClient } from 'viem/account-abstraction';

import {
  createPaymasterBundlerClient,
  describeError,
  isUserOperationKnown,
  sendSerializedUserOperation,
  serializedUserOperationHash,
} from './utils';
import {
  IGenericPaymasterWithdrawalPayload,
  IPaymasterBroadcasterClient,
  PaymasterBroadcastError,
  PaymasterBroadcastResult,
  PaymasterConfirmation,
} from '../relayer/interfaces/paymaster-client.interface';

const waitForConfirmation = async (
  bundlerClient: BundlerClient,
  userOpHash: Hash,
): Promise<PaymasterConfirmation> => {
  let userOpReceipt: Awaited<ReturnType<BundlerClient['waitForUserOperationReceipt']>>;

  try {
    userOpReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  } catch (error) {
    throw new PaymasterBroadcastError(
      'unconfirmed',
      `Could not confirm userOp ${userOpHash}, it may still land: ${describeError(error)}`,
      { userOpHash },
    );
  }

  const txHash = userOpReceipt.receipt.transactionHash;

  if (!userOpReceipt.success) {
    const reason = userOpReceipt.reason ? `: ${userOpReceipt.reason}` : '';

    throw new PaymasterBroadcastError(
      'reverted',
      `UserOp ${userOpHash} reverted in transaction ${txHash}${reason}`,
      { userOpHash, txHash },
    );
  }

  return { txHash };
};

/** Throws unless the bundler knows the userOp whose send request failed with `sendError`. */
const assertKnownToBundler = async (
  bundlerClient: BundlerClient,
  userOpHash: Hash,
  sendError: unknown,
): Promise<void> => {
  let known: boolean;

  try {
    known = await isUserOperationKnown(bundlerClient, userOpHash);
  } catch {
    throw new PaymasterBroadcastError(
      'unconfirmed',
      `Could not tell whether the bundler accepted userOp ${userOpHash}, it may still land: ${describeError(sendError)}`,
      { userOpHash },
    );
  }

  if (!known) {
    throw new PaymasterBroadcastError(
      'not-accepted',
      `Bundler did not accept the userOp: ${describeError(sendError)}`,
    );
  }
};

/**
 * Relays paymaster-sponsored withdrawals to the bundler. The userOps are fully
 * built and signed during the prepare phase (see `paymasterWithdrawThunk`), so
 * this client only forwards them and exposes a way to await their outcome.
 *
 * Every paymaster userOp uses EntryPoint nonce 0, so each withdrawal must have
 * its own sender.
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
      // The bundler may have accepted the userOp and the response got lost,
      // e.g. a timeout.
      const expectedHash = serializedUserOperationHash(userOperation, entryPointAddress);

      if (!expectedHash) {
        throw new PaymasterBroadcastError('not-accepted', `Bundler did not accept the userOp: ${describeError(error)}`);
      }

      await assertKnownToBundler(bundlerClient, expectedHash, error);
      userOpHash = expectedHash;
    }

    return { userOpHash, wait: () => waitForConfirmation(bundlerClient, userOpHash) };
  }
}
