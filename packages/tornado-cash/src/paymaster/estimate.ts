import { estimateWithTransportRetry, estimationUnavailableReason } from './estimation-retry';
import { tornadoFallbackGas } from './fallback';
import type { PaymasterGasEstimation, SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

const GAS_FIELDS = [
  'callGasLimit', 'verificationGasLimit', 'preVerificationGas',
  'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit',
] as const;
const MAX_ESTIMATION_ATTEMPTS = 3;

/**
 * Gas limits affect both the account signature and the fee committed in the
 * sponsoring withdrawal proof. Rebuild them together, then estimate that exact
 * signed payload. Unestimated fallback requires explicit eligibility from the
 * caller, is limited to availability failures, and is marked in the result.
 */
export async function buildEstimatedTornadoUserOp<T extends { userOperation: SerializedUserOperation }>(
  baseline: UserOpGasLimits,
  build: (gas: UserOpGasLimits) => Promise<T>,
  estimate: (op: SerializedUserOperation) => Promise<UserOpGasLimits>,
  options: { allowFallback?: boolean } = {},
): Promise<T & { gasEstimation: PaymasterGasEstimation }> {
  let gas = { ...baseline };

  for (let attempt = 0; attempt < MAX_ESTIMATION_ATTEMPTS; attempt++) {
    const prepared = await build(gas);
    let estimated: UserOpGasLimits;

    try {
      estimated = await estimateWithTransportRetry(() => estimate(prepared.userOperation));
    } catch (cause) {
      const details = cause instanceof Error && 'details' in cause && typeof cause.details === 'string'
        ? cause.details : cause instanceof Error ? cause.message.split('\n')[0] : String(cause);

      const reason = estimationUnavailableReason(cause);

      if (options.allowFallback && reason) {
        // Rebuild at the fallback fee before returning anything. Never patch
        // gas on the old signed operation or reuse its fee-bearing proof.
        const fallbackGas = tornadoFallbackGas(gas, prepared.userOperation);
        const fallback = await build(fallbackGas);

        if (tornadoFallbackGas(fallbackGas, fallback.userOperation).preVerificationGas > fallbackGas.preVerificationGas) {
          throw new Error('Tornado fallback payload size changed during preparation; use required gas estimation.');
        }

        return { ...fallback, gasEstimation: { status: 'fallback', reason, message: details ?? 'Estimation unavailable' } };
      }

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

    if (!changed) return { ...prepared, gasEstimation: { status: 'estimated' } };

    gas = next;
  }

  throw new Error('Tornado paymaster gas estimates did not stabilize after 3 attempts. Withdrawal preparation stopped; retry later or use fewer notes/tail calls.');
}
