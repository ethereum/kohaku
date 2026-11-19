import type { Network } from '@kohaku-eth/plugins';
import type { Address, Hash } from 'viem';
import type { BundlerClient } from 'viem/account-abstraction';

import {
  createPaymasterBundlerClient,
  describeError,
  isAlreadyKnown,
  isBundlerRejection,
  isUserOperationKnown,
  sendSerializedUserOperation,
  serializedUserOperationHash,
} from './utils';
import { aaCode, isReceiptFor } from './bundler-replies';
import type { SerializedUserOperation } from '../interfaces/user-ops.interface';
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
  let userOpReceipt: unknown;

  try {
    userOpReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  } catch (error) {
    throw new PaymasterBroadcastError(
      'unconfirmed',
      `Could not confirm userOp ${userOpHash}, it may still land: ${describeError(error)}`,
      { userOpHash },
    );
  }

  // The receipt is untrusted JSON: anything but a well-formed receipt for this
  // userOp is unknown, never success.
  if (!isReceiptFor(userOpReceipt, userOpHash)) {
    throw new PaymasterBroadcastError(
      'unconfirmed',
      `Bundler returned a malformed receipt for userOp ${userOpHash}, it may still land.`,
      { userOpHash },
    );
  }

  const txHash = userOpReceipt.receipt.transactionHash;

  if (!userOpReceipt.success) {
    // Only an `AAxx` code from the reason: the rest is bundler text, and a
    // non-string reason is never stringified.
    const code = aaCode(userOpReceipt.reason);
    const reason = code ? ` (${code})` : '';

    throw new PaymasterBroadcastError(
      'reverted',
      `UserOp ${userOpHash} reverted in transaction ${txHash}${reason}`,
      { userOpHash, txHash },
    );
  }

  return { txHash };
};

/**
 * Returns the hash of the userOp whose send request failed with `sendError` if
 * the bundler has it, and throws otherwise. Some bundlers, alto among them,
 * only find mined userOps by hash, so a userOp they don't find was only
 * rejected if they answered the send with a JSON-RPC error.
 */
const recoverFromSendError = async (
  bundlerClient: BundlerClient,
  userOpHash: Hash | undefined,
  sendError: unknown,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<Hash> => {
  if (userOpHash && (isAlreadyKnown(sendError) ||
    await isUserOperationKnown(bundlerClient, userOpHash, op, entryPoint).catch(() => false))) {
    return userOpHash;
  }

  if (isBundlerRejection(sendError) && !isAlreadyKnown(sendError)) {
    throw new PaymasterBroadcastError(
      'not-accepted',
      `Bundler did not accept the userOp: ${describeError(sendError)}`,
      { userOpHash },
    );
  }

  throw new PaymasterBroadcastError(
    'unconfirmed',
    `Could not tell whether the bundler accepted ${userOpHash ? `userOp ${userOpHash}` : 'the userOp'}, it may still land: ${describeError(sendError)}`,
    { userOpHash },
  );
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
    { bundlerUrl, entryPointAddress, userOperation, userOpHash: signedHash }: IGenericPaymasterWithdrawalPayload,
    network?: Network,
  ): Promise<PaymasterBroadcastResult> {
    const bundlerClient = createPaymasterBundlerClient(bundlerUrl, network);
    // Payloads prepared by older SDK versions lack the hash; it can then only be
    // computed for a 7702 sender, whose authorization carries the chain.
    const expectedHash = signedHash ?? serializedUserOperationHash(userOperation, entryPointAddress);
    let userOpHash: Hash;

    try {
      userOpHash = await sendSerializedUserOperation(bundlerClient, userOperation, entryPointAddress, expectedHash);
    } catch (error) {
      // The bundler may have accepted the userOp and the response got lost,
      // e.g. a timeout.
      userOpHash = await recoverFromSendError(bundlerClient, expectedHash, error, userOperation, entryPointAddress);
    }

    return { userOpHash, wait: () => waitForConfirmation(bundlerClient, userOpHash) };
  }
}
