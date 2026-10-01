import { UserOpGasLimits } from "../interfaces/user-ops.interface";

const ERC20_TRANSFER_GAS = 100_000n;

// Default execution-phase (callData) budget when a withdrawal carries tail calls
// and the caller supplies no estimate. Covers a simple forward/transfer; complex
// tail calls should pass an explicit `tailCallsGasEstimate`.
export const TAIL_CALLS_DEFAULT_GAS = 300_000n;

// Conservative ceilings for a single-note paymaster withdrawal. The groth16
// verify + 2-depth state/ASP merkle path plus the adapter's inline
// entrypoint.relay run inside paymaster validation, so their cost lives in
// paymasterVerificationGasLimit — callGasLimit is 0 in this flow (funds go
// straight to the recipient during validation). These are refined against the
// bundler's own simulation when available; see `refineGasWithBundler`.
//
// NOTE: privacy-pools circuits differ from tornado-cash's — these baselines are
// a starting point and should be re-measured against a real proof + adapter.
const baseGasUnits: UserOpGasLimits = {
  preVerificationGas: 100_000n,
  verificationGasLimit: 50_000n,
  callGasLimit: 300_000n,
  // The whole withdrawal runs inside paymaster validation: paymaster ->
  // adapter.collectFee -> pool.withdraw (groth16 verify + merkle + change-note
  // insert + payout). Nested external calls each lose 1/64 of the forwarded gas
  // (EIP-150), and bundler estimation can't refine this (simulation itself OOGs
  // below the true cost), so the baseline must comfortably cover it on its own.
  paymasterVerificationGasLimit: 1_200_000n,
  paymasterPostOpGasLimit: 50_000n,
};

export function reasonableGasUnits(isERC20: boolean): UserOpGasLimits {
  if (!isERC20) return baseGasUnits;

  // The fee-paying transfer for ERC20 pools runs inside the adapter during
  // paymaster validation, so its cost belongs to paymasterVerificationGasLimit,
  // not callGasLimit (which is 0 in this flow).
  return {
    ...baseGasUnits,
    paymasterVerificationGasLimit: baseGasUnits.paymasterVerificationGasLimit + ERC20_TRANSFER_GAS,
  };
}

// Execution-phase (callData) budget per extra note in a batch — each is a direct
// pool.withdraw (groth16 verify + merkle + change-note insert + payout). ERC20 adds
// a token transfer to the sender.
const PER_EXTRA_WITHDRAW_GAS = 500_000n;
const PER_EXTRA_WITHDRAW_GAS_ERC20 = 600_000n;
// Synthesized forward of the consolidated balance to the recipient when there are
// no user tail calls.
const FORWARD_GAS = 80_000n;

/**
 * Gas for a batch/consolidating withdrawal. Note[0] is sponsored in paymaster
 * validation (same as `reasonableGasUnits`); `extraWithdrawals` = the remaining notes,
 * run as direct pool.withdraw calls in the execution phase, so their gas belongs to
 * callGasLimit — plus the execution tail (the caller's `tailCallsGasEstimate`, else the
 * synthesized forward).
 */
export function reasonableGasUnitsForBatch(
  isERC20: boolean,
  extraWithdrawals: number,
  hasTailCalls: boolean,
  tailCallsGasEstimate?: bigint,
): UserOpGasLimits {
  const base = reasonableGasUnits(isERC20);
  const perWithdraw = isERC20 ? PER_EXTRA_WITHDRAW_GAS_ERC20 : PER_EXTRA_WITHDRAW_GAS;
  const executionTail = hasTailCalls ? (tailCallsGasEstimate ?? TAIL_CALLS_DEFAULT_GAS) : FORWARD_GAS;

  return {
    ...base,
    callGasLimit: BigInt(extraWithdrawals) * perWithdraw + executionTail,
  };
}

/** The fee amount (in wei) the paymaster expects to break even for these gas limits. */
export function computeMinimumViableFee(
  gasUnits: UserOpGasLimits,
  maxFeePerGas: bigint,
): bigint {
  // 1.2x base-fee multiplier (matches viem's estimateFeesPerGas heuristic).
  const baseFeeMultiplier = 1.2;
  const decimals = baseFeeMultiplier.toString().split(".")[1]?.length ?? 0;
  const denominator = 10 ** decimals;
  const multiply = (base: bigint) =>
    (base * BigInt(Math.ceil(baseFeeMultiplier * denominator))) / BigInt(denominator);

  // EntryPoint's requiredPrefund = sum(all gas limits) * maxFeePerGas.
  const requiredGas =
    gasUnits.verificationGasLimit +
    gasUnits.callGasLimit +
    gasUnits.paymasterVerificationGasLimit +
    gasUnits.preVerificationGas +
    gasUnits.paymasterPostOpGasLimit;

  return multiply(requiredGas * maxFeePerGas);
}
