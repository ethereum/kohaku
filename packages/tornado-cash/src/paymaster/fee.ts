/**
 * Placeholder fee calculation for paymaster-sponsored withdrawals.
 * TODO: Estimate ~700k gas at current gas price from the bundler.
 * For now returns a hardcoded value.
 */
export function estimatePaymasterFee(_gasPrice?: bigint): bigint {
  // ~700_000 gas * ~5 gwei ≈ 0.0035 ETH
  return 700_000n * (_gasPrice || (5n * 10n ** 9n));
}

interface UserOperationGasLimits {
  preVerificationGas: bigint;
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;

}

const ERC20_TRANSFER_GAS = 100_000n;

// Execution-phase (callData) gas budgets used when a batch is consolidated into
// a single userOp. Each extra deposit becomes a direct `pool.withdraw` call
// executed by the ephemeral 7702 account — a groth16 verify plus the payout
// (ERC20 pools add a token transfer to the sender). `FORWARD_GAS` covers the
// final transfer of the accumulated balance to the recipient when the caller
// supplied no tailCalls. These are conservative ceilings; the actual limits are
// refined via bundler estimation when available.
const PER_DIRECT_WITHDRAW_GAS = 400_000n;
const PER_DIRECT_WITHDRAW_GAS_ERC20 = 500_000n;
const FORWARD_GAS = 60_000n;

const baseGasUnits: UserOperationGasLimits = {
  preVerificationGas: 100_000n,
  verificationGasLimit: 50_000n,
  callGasLimit: 300_000n,

  paymasterVerificationGasLimit: 350_000n,
  paymasterPostOpGasLimit: 50_000n,
};

export function reasonableGasUnits(isERC20: boolean): UserOperationGasLimits {
  if (!isERC20) return baseGasUnits;

  // The fee-paying unshield (incl. ERC20 transfers) runs inside the adapter's
  // collectFee during paymaster validation, so the extra ERC20 cost belongs to
  // paymasterVerificationGasLimit — not callGasLimit (which is 0 in this flow).
  return {
    ...baseGasUnits,
    paymasterVerificationGasLimit: baseGasUnits.paymasterVerificationGasLimit + ERC20_TRANSFER_GAS,
  };
}

/**
 * Gas units for a consolidated batch withdrawal (one userOp for the whole
 * batch). deposit[0] is sponsored by the paymaster (its verify/payout stays in
 * paymasterVerificationGasLimit, as in `reasonableGasUnits`); the remaining
 * `extraWithdrawals` deposits run as direct `pool.withdraw` calls in the
 * execution phase, so their gas belongs to callGasLimit. When the caller
 * supplied tailCalls we budget an execution tail for them — prefer a consumer
 * `tailCallsGasEstimate` when provided, otherwise the default base callGasLimit;
 * without user tailCalls we only need the synthesized forward transfer.
 */
export function reasonableGasUnitsForBatch(
  isERC20: boolean,
  extraWithdrawals: number,
  hasUserTailCalls: boolean,
  tailCallsGasEstimate?: bigint,
): UserOperationGasLimits {
  const base = reasonableGasUnits(isERC20);
  const perWithdraw = isERC20 ? PER_DIRECT_WITHDRAW_GAS_ERC20 : PER_DIRECT_WITHDRAW_GAS;
  const executionTail = hasUserTailCalls
    ? (tailCallsGasEstimate ?? base.callGasLimit)
    : FORWARD_GAS;

  return {
    ...base,
    callGasLimit: BigInt(extraWithdrawals) * perWithdraw + executionTail,
  };
}

// The fee amount the paymaster expects to break even
export function computeMinimumViableFee(reasonableGasUnits: UserOperationGasLimits, maxFeePerGas: bigint) {

  // shamelessly stolen from viem https://github.com/wevm/viem/blob/39a98f7ae9fc22d4fe4089c571a91f6c0dc4a05e/src/actions/public/estimateFeesPerGas.ts#L124
  const baseFeeMultiplier = 1.2;
  const decimals = baseFeeMultiplier.toString().split('.')[1]?.length ?? 0;
  const denominator = 10 ** decimals;
  const multiply = (base: bigint) =>
    (base * BigInt(Math.ceil(baseFeeMultiplier * denominator))) /
    BigInt(denominator);


  // from entrypoint contract
  // uint256 requiredGas = mUserOp.verificationGasLimit +
  //                 mUserOp.callGasLimit +
  //                 mUserOp.paymasterVerificationGasLimit +
  //                 mUserOp.paymasterPostOpGasLimit +
  //                 mUserOp.preVerificationGas;
  // requiredPrefund = requiredGas * mUserOp.maxFeePerGas;

  const requiredGas = (reasonableGasUnits.verificationGasLimit +
    reasonableGasUnits.callGasLimit +
    reasonableGasUnits.paymasterVerificationGasLimit +
    reasonableGasUnits.preVerificationGas +
    reasonableGasUnits.paymasterPostOpGasLimit
  );
  const requiredPrefund = requiredGas * maxFeePerGas;

  return multiply(requiredPrefund);
}
