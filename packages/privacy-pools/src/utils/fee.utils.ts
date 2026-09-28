export const BPS_DENOMINATOR = 10_000n;

/**
 * Splits `amount` into the fee charged at `feeBPS` and what remains, using the
 * same floor division as the Entrypoint's `_deductFee` (vetting and relay fees).
 */
export function deductFeeBPS(amount: bigint, feeBPS: bigint): { fee: bigint; net: bigint; } {
  const fee = (amount * feeBPS) / BPS_DENOMINATOR;

  return { fee, net: amount - fee };
}

/**
 * Inverse of {@link deductFeeBPS}: the smallest gross amount that, after a
 * `feeBPS` fee, still leaves at least `net` for the recipient. Used to size an
 * exact-output withdrawal (`Vgross` such that `Vgross - fee >= Vout`).
 *
 * The fee floors, so `deductFeeBPS` is non-decreasing in the gross amount; the
 * closed-form ceiling can overshoot by one base unit, which the trailing check
 * trims to keep the result minimal.
 */
export function grossForNet(net: bigint, feeBPS: bigint): bigint {
  if (net <= 0n) return 0n;

  if (feeBPS <= 0n) return net;

  if (feeBPS >= BPS_DENOMINATOR) throw new Error("feeBPS must be below 100% (10000 bps)");

  const denominator = BPS_DENOMINATOR - feeBPS;
  let gross = (net * BPS_DENOMINATOR + denominator - 1n) / denominator;

  while (gross > 0n && deductFeeBPS(gross - 1n, feeBPS).net >= net) {
    gross -= 1n;
  }

  return gross;
}

/**
 * Minimum output the recipient may receive for a requested exact output, given a
 * slippage allowance in basis points. `slippageBPS` of 0 means no shortfall is
 * tolerated.
 */
export function minAcceptableNet(requestedNet: bigint, slippageBPS: bigint): bigint {
  return requestedNet - (requestedNet * slippageBPS) / BPS_DENOMINATOR;
}
