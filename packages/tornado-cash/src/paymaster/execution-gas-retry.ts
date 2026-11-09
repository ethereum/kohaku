/** Only an explicit execution-gas shortage is eligible. Validation failures,
 * funding/allowance errors, provider caps and nonempty revert data must not
 * cause a larger signed fee budget. Unknown errors remain hard failures. */
export function isExecutionOutOfGas(error: unknown): boolean {
  const messages: string[] = [];
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const item = current as { message?: unknown; details?: unknown; shortMessage?: unknown; data?: unknown; cause?: unknown };
    const detail = typeof item.details === 'string' ? item.details : typeof item.shortMessage === 'string' ? item.shortMessage : typeof item.message === 'string' ? item.message.split('\n')[0] : '';
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
