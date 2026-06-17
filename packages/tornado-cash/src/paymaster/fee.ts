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

const baseGasUnits: UserOperationGasLimits = {
  preVerificationGas: 80_000n,
  verificationGasLimit: 50_000n,
  callGasLimit: 300_000n,

  paymasterVerificationGasLimit: 350_000n,
  paymasterPostOpGasLimit: 10_000n,
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

  console.log("totalGasUnits", requiredGas);
  console.log("maxFeePerGas", maxFeePerGas);
  console.log("requiredPrefund", requiredPrefund);
  console.log("multiply", 1.2);

  return multiply(requiredPrefund);
}
