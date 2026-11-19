import type { Address, Hash } from 'viem';

/**
 * Bundler replies are untrusted JSON. These checks run before the SDK reports a
 * userOp as accepted or mined, so a malformed or mismatched reply is treated
 * as unknown rather than as success.
 */

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An invalid bundler reply, described by the SDK: its message is safe to report. */
export class BundlerReplyError extends Error {
  override name = 'BundlerReplyError';
}

/** A 32-byte 0x-prefixed hex string, such as a userOp or transaction hash. */
export const isHash = (value: unknown): value is Hash => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);

/**
 * The hash in the bundler's answer to `eth_sendUserOperation`. It must be a hash,
 * and the one the sender signed when that is known.
 */
export function parseSendResult(result: unknown, expected?: Hash): Hash {
  if (!isHash(result)) throw new BundlerReplyError('Bundler answered the send with a malformed userOp hash.');

  if (expected && !sameHex(result, expected)) throw new BundlerReplyError('Bundler answered the send with a different userOp hash.');

  return expected ?? result;
}

// Fields covered by the userOp hash, as `eth_getUserOperationByHash` returns
// them, plus the signature. Quantities compare by value, data by bytes.
const QUANTITY_FIELDS = ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas',
  'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const;
const DATA_FIELDS = ['sender', 'factory', 'factoryData', 'callData', 'paymaster', 'paymasterData', 'signature'] as const;

/** The signed fields of a serialized userOp; an absent optional field must be absent or empty in the lookup. */
export type ComparableUserOperation = { sender: string; nonce: string; signature: string } &
  Partial<Record<(typeof QUANTITY_FIELDS)[number] | (typeof DATA_FIELDS)[number], string>>;

const sameQuantity = (value: unknown, expected: string): boolean => {
  if (typeof value !== 'string' && typeof value !== 'bigint') return false;

  try {
    return BigInt(value) === BigInt(expected);
  } catch {
    return false;
  }
};

// A field the SDK did not send is signed as zero or empty, so the lookup must not add one.
const isUnsetQuantity = (value: unknown) => value === undefined || value === null || sameQuantity(value, '0x0');
const isUnsetData = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && sameHex(value, '0x'));

/**
 * Whether an `eth_getUserOperationByHash` result is this userOp: for the same
 * EntryPoint, with every signed field of `op` and its signature, and no signed
 * field that `op` does not have. Sender and nonce alone would also match a
 * different userOp pending with that nonce.
 */
export function isSameUserOperation(result: unknown, op: ComparableUserOperation, entryPoint: Address): boolean {
  if (typeof result !== 'object' || result === null) return false;

  const { userOperation, entryPoint: resultEntryPoint } = result as { userOperation?: Record<string, unknown>; entryPoint?: unknown };

  if (typeof resultEntryPoint !== 'string' || !sameHex(resultEntryPoint, entryPoint)) return false;

  if (typeof userOperation !== 'object' || userOperation === null) return false;

  const sameQuantityField = (field: (typeof QUANTITY_FIELDS)[number]) => {
    const expected = op[field];

    if (expected === undefined) return isUnsetQuantity(userOperation[field]);

    return sameQuantity(userOperation[field], expected);
  };
  const sameDataField = (field: (typeof DATA_FIELDS)[number]) => {
    const expected = op[field];
    const value = userOperation[field];

    if (expected === undefined) return isUnsetData(value);

    return typeof value === 'string' && sameHex(value, expected);
  };

  return QUANTITY_FIELDS.every(sameQuantityField) && DATA_FIELDS.every(sameDataField);
}

/** A userOp receipt whose fields the broadcaster relies on are well formed. */
export type CheckedUserOperationReceipt = { success: boolean; reason?: unknown; receipt: { transactionHash: Hash } };

/**
 * The ERC-4337 `AAxx` code in bundler text, if any. Only the code is reported:
 * the rest of the text can echo the signed userOp in any form.
 */
export const aaCode = (text: unknown): string | undefined =>
  typeof text === 'string' ? /\bAA\d{2}\b/.exec(text)?.[0] : undefined;

/**
 * Whether `receipt` is a well-formed receipt for `userOpHash`, with a boolean
 * `success`, in a successful bundle transaction. A userOp's outcome, success
 * or revert, is recorded by the EntryPoint inside a bundle transaction that
 * succeeds; a reverted bundle transaction or one without a status records
 * neither, so such a contradictory receipt is rejected.
 */
export function isReceiptFor(receipt: unknown, userOpHash: Hash): receipt is CheckedUserOperationReceipt {
  if (typeof receipt !== 'object' || receipt === null) return false;

  const { success, userOpHash: hash, receipt: transaction } = receipt as { success?: unknown; userOpHash?: unknown; receipt?: { transactionHash?: unknown; status?: unknown } };

  if (typeof success !== 'boolean' || !isHash(hash) || !sameHex(hash, userOpHash)) return false;

  if (typeof transaction !== 'object' || transaction === null || !isHash(transaction.transactionHash)) return false;

  // viem formats the transaction status as 'success' or 'reverted'.
  return transaction.status === 'success' || transaction.status === '0x1';
}
