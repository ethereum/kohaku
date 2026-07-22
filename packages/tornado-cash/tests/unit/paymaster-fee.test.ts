import { describe, expect, it } from 'vitest';

import {
  applyGasHeadroom,
  computeMinimumViableFee,
  gasLimitsWithBaselineHeadroom,
  mergeEstimatedGasLimits,
  reasonableGasUnits,
  reasonableGasUnitsForBatch,
} from '../../src/paymaster/fee';

describe('paymaster fee gas limits', () => {
  it('uses updated baselines for preVerificationGas and paymasterPostOpGasLimit', () => {
    const eth = reasonableGasUnits(false);

    expect(eth.preVerificationGas).toBe(85_000n);
    expect(eth.paymasterPostOpGasLimit).toBe(50_000n);
    expect(eth.callGasLimit).toBe(300_000n);
  });

  it('adds ERC20 transfer gas to paymasterVerificationGasLimit only', () => {
    const erc20 = reasonableGasUnits(true);

    expect(erc20.paymasterVerificationGasLimit).toBe(450_000n);
    expect(erc20.callGasLimit).toBe(300_000n);
  });

  it('sizes batch callGasLimit from extra withdrawals and execution tail', () => {
    const ethForwardOnly = reasonableGasUnitsForBatch(false, 1, false);

    expect(ethForwardOnly.callGasLimit).toBe(400_000n + 60_000n);

    const ethWithTail = reasonableGasUnitsForBatch(false, 2, true);

    expect(ethWithTail.callGasLimit).toBe(800_000n + 300_000n);

    const erc20Forward = reasonableGasUnitsForBatch(true, 1, false);

    expect(erc20Forward.callGasLimit).toBe(500_000n + 60_000n);
  });

  it('mergeEstimatedGasLimits buffers only variable gas fields', () => {
    const baseline = reasonableGasUnits(false);
    const merged = mergeEstimatedGasLimits(baseline, {
      callGasLimit: 100_000n,
      verificationGasLimit: 0n,
      preVerificationGas: 90_000n,
      paymasterVerificationGasLimit: 0n,
      paymasterPostOpGasLimit: 0n,
    });

    expect(merged.callGasLimit).toBe(applyGasHeadroom(baseline.callGasLimit));
    expect(merged.verificationGasLimit).toBe(applyGasHeadroom(baseline.verificationGasLimit));
    expect(merged.paymasterVerificationGasLimit).toBe(
      applyGasHeadroom(baseline.paymasterVerificationGasLimit),
    );
    expect(merged.preVerificationGas).toBe(90_000n);
    expect(merged.paymasterPostOpGasLimit).toBe(baseline.paymasterPostOpGasLimit);
  });

  it('computeMinimumViableFee sums all gas fields and applies 1.2× prefund', () => {
    const gas = reasonableGasUnits(false);
    const maxFeePerGas = 10n ** 9n;
    const requiredGas =
      gas.verificationGasLimit +
      gas.callGasLimit +
      gas.paymasterVerificationGasLimit +
      gas.preVerificationGas +
      gas.paymasterPostOpGasLimit;
    const expected = (requiredGas * maxFeePerGas * 12n) / 10n;

    expect(computeMinimumViableFee(gas, maxFeePerGas)).toBe(expected);
  });

  it('gasLimitsWithBaselineHeadroom buffers only variable fields', () => {
    const base = reasonableGasUnits(false);
    const buffered = gasLimitsWithBaselineHeadroom(base);

    expect(buffered.callGasLimit).toBe(applyGasHeadroom(base.callGasLimit));
    expect(buffered.verificationGasLimit).toBe(applyGasHeadroom(base.verificationGasLimit));
    expect(buffered.paymasterVerificationGasLimit).toBe(
      applyGasHeadroom(base.paymasterVerificationGasLimit),
    );
    expect(buffered.preVerificationGas).toBe(base.preVerificationGas);
    expect(buffered.paymasterPostOpGasLimit).toBe(base.paymasterPostOpGasLimit);
  });
});
