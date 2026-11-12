import { size } from 'viem';
import type { SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

/** Retain the existing execution-path allowance for variable batches/tail calls. */
const FALLBACK_PRE_VERIFICATION_OVERHEAD = 350_000n;
/** EIP-7623 nonzero calldata-byte floor: 4 tokens per byte times 10 gas. */
const VARIABLE_BYTE_GAS = 40n;
/** Direct single-note fallback targets. Preserve higher successfully refined
 * limits; these values do not promise admission by every bundler/network. */
const SINGLE_NOTE_PRE_VERIFICATION_GAS = 300_000n;
const SINGLE_NOTE_PAYMASTER_DATA_BYTES = 512n;

export const SINGLE_NOTE_FALLBACK_VERIFICATION_GAS = 150_000n;
export const SINGLE_NOTE_FALLBACK_ERC20_PAYMASTER_GAS = 1_200_000n;
const SINGLE_NOTE_FALLBACK_ETH_PAYMASTER_GAS = 650_000n;

/**
 * Conservative fallback only. Add variable-payload cost to a fixed overhead
 * allowance and retain all previously refined limits. The bundler may still
 * reject this operation; it is not equivalent to a successful gas estimate.
 */
export function tornadoFallbackGas(
  current: UserOpGasLimits,
  operation: SerializedUserOperation,
  isERC20: boolean,
): UserOpGasLimits {
  const direct = operation.callData === '0x' && operation.callGasLimit === '0x0';
  const variableBytes = BigInt(size(operation.callData) + size(operation.paymasterData ?? '0x'));
  const extraBytes = variableBytes > SINGLE_NOTE_PAYMASTER_DATA_BYTES ? variableBytes - SINGLE_NOTE_PAYMASTER_DATA_BYTES : 0n;
  const preVerificationGas = direct
    ? SINGLE_NOTE_PRE_VERIFICATION_GAS + extraBytes * VARIABLE_BYTE_GAS
    : FALLBACK_PRE_VERIFICATION_OVERHEAD + variableBytes * VARIABLE_BYTE_GAS;

  const verificationGasLimit = direct &&
    current.verificationGasLimit < SINGLE_NOTE_FALLBACK_VERIFICATION_GAS
    ? SINGLE_NOTE_FALLBACK_VERIFICATION_GAS : current.verificationGasLimit;

  // ERC20 validation also quotes the fee through the Uniswap oracle and moves
  // tokens. Select the fallback by the pool asset, never by an estimated budget.
  const paymasterFloor = isERC20 ? SINGLE_NOTE_FALLBACK_ERC20_PAYMASTER_GAS : SINGLE_NOTE_FALLBACK_ETH_PAYMASTER_GAS;
  const paymasterVerificationGasLimit = direct && current.paymasterVerificationGasLimit < paymasterFloor
    ? paymasterFloor : current.paymasterVerificationGasLimit;

  return { ...current, verificationGasLimit, paymasterVerificationGasLimit,
    preVerificationGas: current.preVerificationGas > preVerificationGas ? current.preVerificationGas : preVerificationGas };
}
