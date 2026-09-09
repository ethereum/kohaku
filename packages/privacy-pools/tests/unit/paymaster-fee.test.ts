import { describe, expect, it } from 'vitest';

import { computeMinimumViableFee, reasonableGasUnits, reasonableGasUnitsForBatch, TAIL_CALLS_DEFAULT_GAS } from '../../src/paymaster/fee';

describe('paymaster fee math', () => {
  describe('reasonableGasUnits', () => {
    it('keeps callGasLimit non-zero in the baseline (the thunk forces it to 0)', () => {
      const gas = reasonableGasUnits(false);

      expect(gas.callGasLimit).toBe(300_000n);
      expect(gas.paymasterVerificationGasLimit).toBe(1_200_000n);
    });

    it('adds the ERC20 transfer cost to paymaster validation, not callGasLimit', () => {
      const eth = reasonableGasUnits(false);
      const erc20 = reasonableGasUnits(true);

      expect(erc20.paymasterVerificationGasLimit).toBe(eth.paymasterVerificationGasLimit + 100_000n);
      expect(erc20.callGasLimit).toBe(eth.callGasLimit);
    });
  });

  describe('computeMinimumViableFee', () => {
    it('sums every gas field, prices at maxFeePerGas, and applies the 1.2x buffer', () => {
      const gas = reasonableGasUnits(false);
      const maxFeePerGas = 1_000_000_000n; // 1 gwei

      const totalGas =
        gas.verificationGasLimit +
        gas.callGasLimit +
        gas.paymasterVerificationGasLimit +
        gas.preVerificationGas +
        gas.paymasterPostOpGasLimit;

      const expected = (totalGas * maxFeePerGas * 12n) / 10n;

      expect(computeMinimumViableFee(gas, maxFeePerGas)).toBe(expected);
    });

    it('scales linearly with maxFeePerGas', () => {
      const gas = reasonableGasUnits(true);

      expect(computeMinimumViableFee(gas, 2n)).toBe(computeMinimumViableFee(gas, 1n) * 2n);
    });
  });

  describe('reasonableGasUnitsForBatch', () => {
    it('budgets callGasLimit for the extra direct withdraws + a forward', () => {
      const gas = reasonableGasUnitsForBatch(false, 2, false);

      // 2 extra native withdraws (500k each) + forward (80k).
      expect(gas.callGasLimit).toBe(2n * 500_000n + 80_000n);
      // Sponsoring note's cost is unchanged (paymaster validation).
      expect(gas.paymasterVerificationGasLimit).toBe(reasonableGasUnits(false).paymasterVerificationGasLimit);
    });

    it('uses the larger ERC20 per-withdraw budget', () => {
      const eth = reasonableGasUnitsForBatch(false, 3, false);
      const erc20 = reasonableGasUnitsForBatch(true, 3, false);

      expect(erc20.callGasLimit - eth.callGasLimit).toBe(3n * (600_000n - 500_000n));
    });

    it('uses the tail-call estimate (or default) for the execution tail when tail calls are present', () => {
      expect(reasonableGasUnitsForBatch(false, 1, true).callGasLimit).toBe(500_000n + TAIL_CALLS_DEFAULT_GAS);
      expect(reasonableGasUnitsForBatch(false, 1, true, 123_456n).callGasLimit).toBe(500_000n + 123_456n);
    });
  });
});
