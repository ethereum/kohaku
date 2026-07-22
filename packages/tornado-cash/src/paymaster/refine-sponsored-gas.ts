import type { Address } from 'viem';
import type { BundlerClient } from 'viem/account-abstraction';

import type { SerializedUserOperation } from '../interfaces/user-ops.interface';
import type { UserOpGasLimits } from '../interfaces/user-ops.interface';
import {
  computeMinimumViableFee,
  gasLimitsWithBaselineHeadroom,
  mergeEstimatedGasLimits,
} from './fee';
import { estimateUserOperationGasWithRetry } from './utils';

import type { TornadoProveOutput } from '../utils/tornado-prover';

export type QuoteEthFeeInPoolAsset = (ethPrefundFee: bigint) => Promise<bigint>;

export type BuildSignedPaymasterOp = (
  gas: UserOpGasLimits,
  fee: bigint,
  paymasterData: `0x${string}`,
) => Promise<SerializedUserOperation>;

export type ProvePaymasterAtFee = (fee: bigint) => Promise<{
  paymasterData: `0x${string}`;
  proof: TornadoProveOutput;
}>;

/**
 * Sizes gas from the bundler once, applies SDK headroom, aligns proof fee to
 * final limits, and returns a single signed userOp (no post-prepare mutation).
 */
export async function buildSponsoredUserOpWithGasRefinement({
  bundlerClient,
  entryPointAddress,
  baselineGas,
  maxFeePerGas,
  quoteFee,
  proveAtFee,
  buildSignedOp,
}: {
  bundlerClient: BundlerClient;
  entryPointAddress: Address;
  baselineGas: UserOpGasLimits;
  maxFeePerGas: bigint;
  quoteFee: QuoteEthFeeInPoolAsset;
  proveAtFee: ProvePaymasterAtFee;
  buildSignedOp: BuildSignedPaymasterOp;
}): Promise<{
  userOperation: SerializedUserOperation;
  gas: UserOpGasLimits;
  fee: bigint;
  proof: TornadoProveOutput;
}> {
  let fee = await quoteFee(computeMinimumViableFee(baselineGas, maxFeePerGas));
  let proved = await proveAtFee(fee);
  const draftOp = await buildSignedOp(baselineGas, fee, proved.paymasterData);

  let refinedGas: UserOpGasLimits;

  try {
    const estimated = await estimateUserOperationGasWithRetry(
      bundlerClient,
      draftOp,
      entryPointAddress,
    );

    refinedGas = mergeEstimatedGasLimits(baselineGas, estimated);
  } catch {
    refinedGas = gasLimitsWithBaselineHeadroom(baselineGas);
  }

  fee = await quoteFee(computeMinimumViableFee(refinedGas, maxFeePerGas));
  proved = await proveAtFee(fee);
  const userOperation = await buildSignedOp(refinedGas, fee, proved.paymasterData);

  return { userOperation, gas: refinedGas, fee, proof: proved.proof };
}
