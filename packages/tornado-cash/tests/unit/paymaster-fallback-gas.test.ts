import { describe, expect, it } from 'vitest';
import type { SerializedUserOperation } from '../../src/interfaces/user-ops.interface';
import { tornadoFallbackGas } from '../../src/paymaster/fallback';
import { reasonableGasUnitsForBatch } from '../../src/paymaster/fee';

const operation = { callData: `0x${'11'.repeat(100)}`, paymasterData: `0x${'22'.repeat(200)}` } as SerializedUserOperation;

describe('payload-aware fallback gas', () => {
  it('covers the observed pre-verification rejection and increases with variable payload size', () => {
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const gas = tornadoFallbackGas(base, operation);
    expect(gas.preVerificationGas).toBe(350_000n + 300n * 40n);
    const longer = tornadoFallbackGas(base, { ...operation, callData: `0x${'11'.repeat(1100)}` });
    expect(longer.preVerificationGas - gas.preVerificationGas).toBe(1000n * 40n);
    expect(base.preVerificationGas).toBe(100_000n);
  });

  it('retains ETH/ERC20 and per-note shape budgets without reducing previously refined gas', () => {
    for (const isERC20 of [false, true]) {
      for (const extraNotes of [0, 1, 5]) {
        const base = reasonableGasUnitsForBatch(isERC20, extraNotes, false);
        const gas = tornadoFallbackGas(base, operation);
        expect(gas.callGasLimit).toBe(base.callGasLimit);
        expect(gas.paymasterVerificationGasLimit).toBe(isERC20 ? 550_000n : 450_000n);
        const high = { ...base, preVerificationGas: 900_000n, callGasLimit: 5_000_000n };
        expect(tornadoFallbackGas(high, operation)).toEqual(high);
      }
    }
  });
});
