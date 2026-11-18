import type { Address, Hash } from 'viem';

/**
 * Bundler replies are untrusted JSON. These checks run before the SDK reports a
 * userOp as accepted or mined, so a malformed or mismatched reply is treated
 * as unknown rather than as success.
 */

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A 32-byte 0x-prefixed hex string, such as a userOp or transaction hash. */
export const isHash = (value: unknown): value is Hash => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);

/**
 * The hash in the bundler's answer to `eth_sendUserOperation`. It must be a hash,
 * and the one the sender signed when that is known.
 */
export function parseSendResult(result: unknown, expected?: Hash): Hash {
  if (!isHash(result)) throw new Error('Bundler answered the send with a malformed userOp hash.');

  if (expected && !sameHex(result, expected)) throw new Error('Bundler answered the send with a different userOp hash.');

  return expected ?? result;
}

/**
 * Whether an `eth_getUserOperationByHash` result is this userOp: an object for
 * the same EntryPoint, sender and nonce, which identify one userOp on chain.
 */
export function isSameUserOperation(result: unknown, op: { sender: string; nonce: string }, entryPoint: Address): boolean {
  if (typeof result !== 'object' || result === null) return false;

  const { userOperation, entryPoint: resultEntryPoint } = result as { userOperation?: { sender?: unknown; nonce?: unknown }; entryPoint?: unknown };
  const nonce = userOperation?.nonce;

  try {
    return typeof resultEntryPoint === 'string' && sameHex(resultEntryPoint, entryPoint) &&
      typeof userOperation?.sender === 'string' && sameHex(userOperation.sender, op.sender) &&
      (typeof nonce === 'string' || typeof nonce === 'bigint') && BigInt(nonce) === BigInt(op.nonce);
  } catch {
    return false;
  }
}

/** A userOp receipt whose fields the broadcaster relies on are well formed. */
export type CheckedUserOperationReceipt = { success: boolean; reason?: unknown; receipt: { transactionHash: Hash } };

/** Whether `receipt` is a well-formed receipt for `userOpHash`, with a boolean `success`. */
export function isReceiptFor(receipt: unknown, userOpHash: Hash): receipt is CheckedUserOperationReceipt {
  if (typeof receipt !== 'object' || receipt === null) return false;

  const { success, userOpHash: hash, receipt: transaction } = receipt as { success?: unknown; userOpHash?: unknown; receipt?: { transactionHash?: unknown } };

  return typeof success === 'boolean' && isHash(hash) && sameHex(hash, userOpHash) &&
    typeof transaction === 'object' && transaction !== null && isHash(transaction.transactionHash);
}
