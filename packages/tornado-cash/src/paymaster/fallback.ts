import { size } from 'viem';
import type { SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

/** Above the observed 281260 requirement with >20% headroom; not a universal minimum. */
const FALLBACK_PRE_VERIFICATION_OVERHEAD = 350_000n;
/** EIP-7623 nonzero calldata-byte floor: 4 tokens per byte times 10 gas. */
const VARIABLE_BYTE_GAS = 40n;

/**
 * Conservative fallback only. Add variable-payload cost to a fixed overhead
 * allowance and retain all previously refined limits. The bundler may still
 * reject this operation; it is not equivalent to a successful gas estimate.
 */
export function tornadoFallbackGas(
  current: UserOpGasLimits,
  operation: SerializedUserOperation,
): UserOpGasLimits {
  const variableBytes = BigInt(size(operation.callData) + size(operation.paymasterData ?? '0x'));
  const preVerificationGas = FALLBACK_PRE_VERIFICATION_OVERHEAD + variableBytes * VARIABLE_BYTE_GAS;

  return { ...current, preVerificationGas: current.preVerificationGas > preVerificationGas ? current.preVerificationGas : preVerificationGas };
}
