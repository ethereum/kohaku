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

export interface ExactRelayerSizing {
  /** Gross to withdraw so the recipient nets exactly the requested output. */
  grossAmount: bigint;
  /** Integer relay fee (bps) to embed in the withdrawal data. */
  feeBPS: bigint;
}

/**
 * Sizes an exact-output relayer withdrawal from a decomposed quote.
 *
 * A relayer fee splits into a proportional base rate (`baseFeeBPS`, the relayer's
 * fixed earn rate, stable between quotes) and a gas cost (`gasMoney`, an absolute
 * amount in the pool asset's units that is ~constant across withdrawal sizes). So
 * `net = gross*(1 - baseFeeBPS/10000) - gasMoney`, which inverts to
 * `gross = (net + gasMoney) / (1 - baseFeeBPS/10000)`.
 *
 * Only the gas term is volatile between quote and submission, so `gasBumpBPS` adds
 * headroom to `gasMoney` alone (not the base rate) to absorb gas spikes without
 * overpaying the relayer's margin. The embedded rate is then the integer bps that
 * covers base + bumped gas at that gross; the gross is re-derived with
 * {@link grossForNet} so the floored on-chain deduction leaves exactly `net`.
 *
 * Throws if the required rate exceeds `maxRelayFeeBPS` (the Entrypoint reverts
 * above it): the withdrawal is infeasible at that size.
 */
export function sizeExactRelayerWithdrawal(params: {
  requestedNet: bigint;
  baseFeeBPS: bigint;
  gasMoney: bigint;
  gasBumpBPS: bigint;
  maxRelayFeeBPS: bigint;
}): ExactRelayerSizing {
  const { requestedNet, baseFeeBPS, gasMoney, gasBumpBPS, maxRelayFeeBPS } = params;

  if (requestedNet <= 0n) throw new Error("requestedNet must be greater than zero");

  if (baseFeeBPS >= BPS_DENOMINATOR) throw new Error("baseFeeBPS must be below 100% (10000 bps)");

  const safeGasMoney = gasMoney > 0n ? gasMoney : 0n;
  const bumpedGas = gasBumpBPS > 0n
    ? (safeGasMoney * (BPS_DENOMINATOR + gasBumpBPS)) / BPS_DENOMINATOR
    : safeGasMoney;

  // Closed-form gross for the bumped fee, then the integer rate that covers the gas
  // component at that gross (ceil so we never embed below the relayer's cost).
  const denominator = BPS_DENOMINATOR - baseFeeBPS;
  const grossEstimate = ((requestedNet + bumpedGas) * BPS_DENOMINATOR + denominator - 1n) / denominator;
  const gasBPS = grossEstimate > 0n
    ? (bumpedGas * BPS_DENOMINATOR + grossEstimate - 1n) / grossEstimate
    : 0n;
  const feeBPS = baseFeeBPS + gasBPS;

  if (feeBPS > maxRelayFeeBPS) {
    throw new Error(
      `Exact-output infeasible: required relay fee ${feeBPS} bps exceeds maxRelayFeeBPS ${maxRelayFeeBPS} bps`,
    );
  }

  return { grossAmount: grossForNet(requestedNet, feeBPS), feeBPS };
}
