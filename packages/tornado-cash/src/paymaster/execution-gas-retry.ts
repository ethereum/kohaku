import { BaseError, RpcRequestError } from 'viem';

/** ERC-7769: the userOp reverted, or ran out of gas, in its execution phase (alto's `UserOperationReverted`). */
const EXECUTION_REVERTED_CODE = -32521;

/** Only an explicit execution-gas shortage is eligible: a bundler JSON-RPC
 * rejection with the execution-phase code whose text says out of gas.
 * Validation failures, funding/allowance errors, provider caps, nonempty revert
 * data, transport errors and any other error must not cause a larger signed fee
 * budget. Unknown errors remain hard failures. */
export function isExecutionOutOfGas(error: unknown): boolean {
  const rejection = error instanceof BaseError ? error.walk((cause) => cause instanceof RpcRequestError) as RpcRequestError | null : null;

  // Words alone are not evidence: they can come from any error text.
  if (rejection?.code !== EXECUTION_REVERTED_CODE) return false;

  const messages: string[] = [];
  const seen = new Set<object>();
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const item = current as { message?: unknown; details?: unknown; shortMessage?: unknown; data?: unknown; cause?: unknown };
    const detail = typeof item.details === 'string' ? item.details
      : typeof item.shortMessage === 'string' ? item.shortMessage
      : typeof item.message === 'string' ? item.message.split('\n')[0] ?? '' : '';

    messages.push(detail);

    if (typeof item.data === 'string' && /^0x[0-9a-f]+$/i.test(item.data)) return false;

    if (item.data && typeof item.data === 'object') return false;

    current = item.cause;
  }

  if (typeof error === 'string') messages.push(error);

  const text = messages.join(' ');

  if (/\bAA\d{2}\b|verificationGasLimit|preVerificationGas|paymaster|\bvalidation\b|intrinsic gas|exceeds allowance|rpc.gascap|gas (?:cap|ceiling)|insufficient (?:funds|balance|allowance)|not enough (?:funds|balance)|transfer amount exceeds|execution reverted.*(?:reason|Error\()/i.test(text)) return false;

  return /\bexecution\b.{0,80}\bout of gas\b|\bcallGasLimit (?:is )?(?:too low|insufficient)\b|\bexecution gas limit (?:too low|exceeded)\b/i.test(text);
}
