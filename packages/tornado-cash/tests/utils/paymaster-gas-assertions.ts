import { expect } from 'vitest';
import type { Address } from 'viem';
import type { BundlerClient } from 'viem/account-abstraction';

import {
  applyGasHeadroom,
  computeMinimumViableFee,
} from '../../src/paymaster/fee';
import type { SerializedUserOperation, UserOpGasLimits } from '../../src/interfaces/user-ops.interface';
import { estimateUserOperationGas } from '../../src/paymaster/utils';

export function parseUserOpGasLimits(op: SerializedUserOperation): UserOpGasLimits {
  return {
    callGasLimit: BigInt(op.callGasLimit),
    verificationGasLimit: BigInt(op.verificationGasLimit),
    preVerificationGas: BigInt(op.preVerificationGas),
    paymasterVerificationGasLimit: BigInt(op.paymasterVerificationGasLimit ?? 0),
    paymasterPostOpGasLimit: BigInt(op.paymasterPostOpGasLimit ?? 0),
  };
}

/** Assert prepared UserOp gas limits clear headroom vs a fresh bundler estimate. */
export async function assertPaymasterUserOpGasInvariants({
  bundlerClient,
  entryPointAddress,
  userOperation,
  maxFeePerGas,
  proofFeeWei,
}: {
  bundlerClient: BundlerClient;
  entryPointAddress: Address;
  userOperation: SerializedUserOperation;
  maxFeePerGas: bigint;
  /** ETH-denominated proof fee; omit for ERC20 (quoted token fee ≠ wei prefund). */
  proofFeeWei?: bigint;
}): Promise<void> {
  const finalGas = parseUserOpGasLimits(userOperation);

  expect(finalGas.callGasLimit).toBeGreaterThan(0n);

  const estimated = await estimateUserOperationGas(bundlerClient, userOperation, entryPointAddress);
  const variableFields: (keyof UserOpGasLimits)[] = [
    'callGasLimit',
    'verificationGasLimit',
    'paymasterVerificationGasLimit',
  ];

  for (const field of variableFields) {
    const estimate = estimated[field];

    if (estimate > 0n) {
      expect(finalGas[field]).toBeGreaterThanOrEqual(applyGasHeadroom(estimate));
    }
  }

  for (const field of ['preVerificationGas', 'paymasterPostOpGasLimit'] as const) {
    const estimate = estimated[field];

    if (estimate > 0n) {
      expect(finalGas[field]).toBeGreaterThanOrEqual(estimate);
    }
  }

  if (proofFeeWei != null) {
    expect(proofFeeWei).toBeGreaterThanOrEqual(computeMinimumViableFee(finalGas, maxFeePerGas));
  }
}
