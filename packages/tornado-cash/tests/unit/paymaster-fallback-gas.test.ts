import { describe, expect, it } from 'vitest';
import type { SerializedUserOperation } from '../../src/interfaces/user-ops.interface';
import { tornadoFallbackGas } from '../../src/paymaster/fallback';
import { assertGasLimitsWithinBounds } from '../../src/paymaster/gas-bounds';
import { reasonableGasUnits, reasonableGasUnitsForBatch } from '../../src/paymaster/fee';

const operation = { callData: `0x${'11'.repeat(100)}`, paymasterData: `0x${'22'.repeat(200)}` } as SerializedUserOperation;

describe('payload-aware fallback gas', () => {
  it.each([false, true])('sets the requested direct fallback targets within gas ceilings (ERC20=%s)', isERC20 => {
    const base = { ...reasonableGasUnits(isERC20), callGasLimit: 0n };
    const direct = { ...operation, callData: '0x', callGasLimit: '0x0', paymasterData: `0x${'22'.repeat(512)}` } as SerializedUserOperation;
    const gas = tornadoFallbackGas(base, direct, isERC20);

    expect(gas.preVerificationGas).toBe(300_000n);
    expect(gas.preVerificationGas).toBeGreaterThan(281_260n);
    expect(gas.verificationGasLimit).toBe(150_000n);
    expect(gas.callGasLimit).toBe(0n);
    expect(gas.paymasterVerificationGasLimit).toBe(isERC20 ? 1_200_000n : 650_000n);
    expect(() => assertGasLimitsWithinBounds(gas, base, direct, { paymasterVerificationGasLimit: 450_000n }, isERC20)).toThrow('gas ceiling 450000');
    expect(tornadoFallbackGas(gas, direct, isERC20)).toEqual(gas);
    const refined = { ...gas, preVerificationGas: 337_512n, paymasterVerificationGasLimit: 1_500_000n };

    expect(tornadoFallbackGas(refined, direct, isERC20)).toEqual(refined);
    expect(gas.paymasterPostOpGasLimit).toBe(base.paymasterPostOpGasLimit);
    expect(() => assertGasLimitsWithinBounds(gas, base, direct, {}, isERC20)).not.toThrow();
    expect(() => assertGasLimitsWithinBounds({ ...gas, verificationGasLimit: 250_001n }, base, direct, {}, isERC20)).toThrow('gas ceiling 250000');
    expect(() => assertGasLimitsWithinBounds(gas, base, direct, { verificationGasLimit: 99_999n }, isERC20)).toThrow('gas ceiling 99999');
    expect(tornadoFallbackGas({ ...gas, verificationGasLimit: 300_000n }, direct, isERC20).verificationGasLimit).toBe(300_000n);
    expect(base.verificationGasLimit).toBe(50_000n);
  });

  it('permits the ERC20 fallback without widening ETH bounds or overriding explicit caps', () => {
    const direct = { ...operation, callData: '0x', callGasLimit: '0x0' } as SerializedUserOperation;
    const base = { ...reasonableGasUnits(true), callGasLimit: 0n };
    const gas = tornadoFallbackGas(base, direct, true);

    expect(() => assertGasLimitsWithinBounds(gas, base, direct, {}, true)).not.toThrow();
    expect(() => assertGasLimitsWithinBounds(gas, base, direct, { paymasterVerificationGasLimit: 1_100_000n }, true)).toThrow('gas ceiling 1100000');
    expect(() => assertGasLimitsWithinBounds({ ...gas, paymasterVerificationGasLimit: 1_200_001n }, base, direct, {}, true)).toThrow('gas ceiling 1200000');
    const native = { ...reasonableGasUnits(false), callGasLimit: 0n };

    expect(() => assertGasLimitsWithinBounds({ ...gas, paymasterVerificationGasLimit: 900_001n }, native, direct)).toThrow('gas ceiling 900000');
  });

  it('keeps direct fallback payload-aware when paymaster data grows', () => {
    const base = { ...reasonableGasUnits(false), callGasLimit: 0n };
    const direct = { ...operation, callData: '0x', callGasLimit: '0x0', paymasterData: `0x${'22'.repeat(512)}` } as SerializedUserOperation;
    const gas = tornadoFallbackGas(base, direct, false);
    const longer = tornadoFallbackGas(base, { ...direct, paymasterData: `0x${'22'.repeat(1024)}` }, false);

    expect(longer.preVerificationGas - gas.preVerificationGas).toBe(512n * 40n);
    expect(longer.paymasterVerificationGasLimit).toBe(650_000n);
    expect(longer.paymasterPostOpGasLimit).toBe(50_000n);
  });

  it('covers the observed pre-verification rejection and increases with variable payload size', () => {
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const gas = tornadoFallbackGas(base, operation, false);

    expect(gas.preVerificationGas).toBe(350_000n + 300n * 40n);
    const longer = tornadoFallbackGas(base, { ...operation, callData: `0x${'11'.repeat(1100)}` }, false);

    expect(longer.preVerificationGas - gas.preVerificationGas).toBe(1000n * 40n);
    expect(base.preVerificationGas).toBe(100_000n);
  });

  it('retains ETH/ERC20 and per-note shape budgets without reducing previously refined gas', () => {
    for (const isERC20 of [false, true]) {
      for (const extraNotes of [0, 1, 5]) {
        const base = reasonableGasUnitsForBatch(isERC20, extraNotes, false);
        const gas = tornadoFallbackGas(base, operation, isERC20);

        expect(gas.callGasLimit).toBe(base.callGasLimit);
        expect(gas.paymasterVerificationGasLimit).toBe(isERC20 ? 550_000n : 450_000n);
        const high = { ...base, preVerificationGas: 900_000n, callGasLimit: 5_000_000n };

        expect(tornadoFallbackGas(high, operation, isERC20)).toEqual(high);
      }
    }
  });
});
