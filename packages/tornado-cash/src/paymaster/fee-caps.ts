import { IGasFeeReference } from '../data/interfaces/data.service.interface';
import { UserOpGasLimits } from '../interfaces/user-ops.interface';
import { GasPrice } from './utils';

// Client-side bounds on what the bundler may set. The paymaster refunds
// `fee - actualGasCost` in postOp, but the bundler is paid the gas price and the
// full preVerificationGas it chose, up to the fee committed in the proof. Without
// bounds a bundler could set them so high that it takes most of the note.
// Mirrors packages/privacy-pools/src/paymaster/fee-caps.ts.

/**
 * Default cap on the sponsored fee, as a share of the withdrawn amount
 * (bps, 10000 = 100%). The same default as the Privacy Pools plugin, which
 * matches that protocol's on-chain cap on relayer fees.
 */
export const DEFAULT_PAYMASTER_MAX_FEE_BPS = 1_000n;

// The base fee can rise at most 12.5% per block, so 3x covers ~9 full blocks
// (about two minutes) after our read; bundlers quote roughly 1.2-2x base fee.
const BASE_FEE_CAP_MULTIPLIER = 3n;
// Nodes disagree widely on the suggested tip (on mainnet one RPC suggested
// 0.00001 gwei while Pimlico quoted 0.065 gwei), so a floor carries quiet
// markets and the multiplier follows a busy one.
const PRIORITY_FEE_CAP_MULTIPLIER = 3n;
const PRIORITY_FEE_CAP_FLOOR = 2_000_000_000n; // 2 gwei

// Bundler-refined limits (estimate + 20% buffer) may exceed our static
// baseline by at most this factor.
export const GAS_LIMIT_CAP_MULTIPLIER = 2n;

/** The highest gas prices accepted from the bundler, given the chain's own fee market. */
export function gasPriceCaps({ baseFeePerGas, maxPriorityFeePerGas }: IGasFeeReference): GasPrice {
  const suggestedTipCap = maxPriorityFeePerGas * PRIORITY_FEE_CAP_MULTIPLIER;
  const priorityCap = suggestedTipCap > PRIORITY_FEE_CAP_FLOOR ? suggestedTipCap : PRIORITY_FEE_CAP_FLOOR;

  return {
    maxFeePerGas: baseFeePerGas * BASE_FEE_CAP_MULTIPLIER + priorityCap,
    maxPriorityFeePerGas: priorityCap,
  };
}

/** Throws if the bundler's gas price is above the caps derived from `reference`. */
export function assertGasPriceWithinCaps(price: GasPrice, reference: IGasFeeReference): void {
  const caps = gasPriceCaps(reference);

  if (price.maxPriorityFeePerGas > caps.maxPriorityFeePerGas) {
    throw new Error(
      `Bundler maxPriorityFeePerGas ${price.maxPriorityFeePerGas} exceeds the cap ${caps.maxPriorityFeePerGas} wei`,
    );
  }

  if (price.maxFeePerGas > caps.maxFeePerGas) {
    throw new Error(
      `Bundler maxFeePerGas ${price.maxFeePerGas} exceeds the cap ${caps.maxFeePerGas} wei ` +
        `(chain base fee ${reference.baseFeePerGas} wei)`,
    );
  }
}

/** Throws if any bundler-refined limit is above `GAS_LIMIT_CAP_MULTIPLIER` x the local baseline. */
export function assertGasLimitsWithinCaps(refined: UserOpGasLimits, baseline: UserOpGasLimits): void {
  for (const field of Object.keys(baseline) as (keyof UserOpGasLimits)[]) {
    const cap = baseline[field] * GAS_LIMIT_CAP_MULTIPLIER;

    if (refined[field] > cap) {
      throw new Error(`Bundler ${field} ${refined[field]} exceeds the cap ${cap} (${GAS_LIMIT_CAP_MULTIPLIER}x the baseline)`);
    }
  }
}

/** Throws if `fee` is above `maxFeeBPS` of `withdrawn`. */
export function assertFeeWithinCap(fee: bigint, withdrawn: bigint, maxFeeBPS = DEFAULT_PAYMASTER_MAX_FEE_BPS): void {
  if (maxFeeBPS <= 0n || maxFeeBPS > 10_000n) {
    throw new Error(`maxFeeBPS must be in (0, 10000], got ${maxFeeBPS}`);
  }

  if (fee * 10_000n > withdrawn * maxFeeBPS) {
    throw new Error(
      `Sponsored gas fee ${fee} exceeds ${maxFeeBPS} bps of the withdrawn amount ${withdrawn}; ` +
        `raise maxFeeBPS to accept it`,
    );
  }
}
