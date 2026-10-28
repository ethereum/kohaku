import type { SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

const GAS_FIELDS = [
  'callGasLimit', 'verificationGasLimit', 'preVerificationGas',
  'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit',
] as const;
const MAX_ESTIMATION_ATTEMPTS = 3;

/**
 * Gas limits affect both the account signature and the fee committed in the
 * sponsoring withdrawal proof. Rebuild them together, then estimate that exact
 * signed payload. Never return static fallback limits after an estimation error.
 */
export async function buildEstimatedTornadoUserOp<T extends { userOperation: SerializedUserOperation }>(
  baseline: UserOpGasLimits,
  build: (gas: UserOpGasLimits) => Promise<T>,
  estimate: (op: SerializedUserOperation) => Promise<UserOpGasLimits>,
): Promise<T> {
  let gas = { ...baseline };

  for (let attempt = 0; attempt < MAX_ESTIMATION_ATTEMPTS; attempt++) {
    const prepared = await build(gas);
    let estimated: UserOpGasLimits;

    try {
      estimated = await estimate(prepared.userOperation);
    } catch (cause) {
      const details = cause instanceof Error && 'details' in cause && typeof cause.details === 'string'
        ? cause.details : cause instanceof Error ? cause.message.split('\n')[0] : String(cause);

      throw new Error(`Tornado paymaster gas estimation failed: ${details}. Withdrawal preparation stopped; no operation was submitted.`, { cause });
    }

    if (estimated.preVerificationGas <= 0n || estimated.verificationGasLimit <= 0n ||
        GAS_FIELDS.some((field) => typeof estimated[field] !== 'bigint' || estimated[field] < 0n)) {
      throw new Error('Tornado bundler returned invalid gas estimates. Withdrawal preparation stopped.');
    }

    const next = { ...gas };
    let changed = false;

    for (const field of GAS_FIELDS) {
      // Direct single-note withdrawals execute entirely in paymaster validation.
      // A nonzero execution limit would violate their recipient != sender rule.
      if (field === 'callGasLimit' && prepared.userOperation.callData === '0x') continue;

      // Keep the baseline floor and add 20% headroom to each estimate. Limits
      // only increase, avoiding fee/proof oscillation between iterations.
      const buffered = (estimated[field] * 12n + 9n) / 10n;

      if (buffered > next[field]) {
        next[field] = buffered;
        changed = true;
      }
    }

    if (!changed) return prepared;

    gas = next;
  }

  throw new Error('Tornado paymaster gas estimates did not stabilize after 3 attempts. Withdrawal preparation stopped; retry later or use fewer notes/tail calls.');
}
