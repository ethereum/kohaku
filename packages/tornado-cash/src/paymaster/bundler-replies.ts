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

// Fields covered by the userOp hash, as `eth_getUserOperationByHash` returns
// them, plus the signature. Quantities compare by value, data by bytes.
const QUANTITY_FIELDS = ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas',
  'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const;
const DATA_FIELDS = ['sender', 'factory', 'factoryData', 'callData', 'paymaster', 'paymasterData', 'signature'] as const;

/** The signed fields of a serialized userOp; absent optional fields are not compared. */
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

/**
 * Whether an `eth_getUserOperationByHash` result is this userOp: for the same
 * EntryPoint, with every signed field of `op` and its signature. Sender and
 * nonce alone would also match a different userOp pending with that nonce.
 */
export function isSameUserOperation(result: unknown, op: ComparableUserOperation, entryPoint: Address): boolean {
  if (typeof result !== 'object' || result === null) return false;

  const { userOperation, entryPoint: resultEntryPoint } = result as { userOperation?: Record<string, unknown>; entryPoint?: unknown };

  if (typeof resultEntryPoint !== 'string' || !sameHex(resultEntryPoint, entryPoint)) return false;

  if (typeof userOperation !== 'object' || userOperation === null) return false;

  return QUANTITY_FIELDS.every((field) => op[field] === undefined || sameQuantity(userOperation[field], op[field])) &&
    DATA_FIELDS.every((field) => {
      const expected = op[field];
      const value = userOperation[field];

      return expected === undefined || (typeof value === 'string' && sameHex(value, expected));
    });
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

const MAX_PUBLIC_TEXT = 300;

/**
 * Bundler-provided text for messages documented as safe to report. A bundler
 * can echo the signed userOp in an error, so hex runs longer than a 32-byte
 * hash (signatures, proofs, calldata) are elided and the text is bounded.
 */
export function redact(text: string): string {
  const elided = text.replace(/(?:0x)?[0-9a-f]{65,}/gi, '0x…');

  return elided.length > MAX_PUBLIC_TEXT ? `${elided.slice(0, MAX_PUBLIC_TEXT)}…` : elided;
}
