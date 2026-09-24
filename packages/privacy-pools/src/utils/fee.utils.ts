const BPS_DENOMINATOR = 10_000n;

/**
 * Splits `amount` into the fee charged at `feeBPS` and what remains, using the
 * same floor division as the Entrypoint's `_deductFee` (vetting and relay fees).
 */
export function deductFeeBPS(amount: bigint, feeBPS: bigint): { fee: bigint; net: bigint; } {
  const fee = (amount * feeBPS) / BPS_DENOMINATOR;

  return { fee, net: amount - fee };
}
