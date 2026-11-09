import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEther } from 'viem';
import type { INote } from '../../src/plugin/interfaces/protocol-params.interface';
import { planPPv1BatchWithdrawal, PPv1AmountObfuscationError } from '../../src/withdrawal/batch-plan';

const asset = 1n;
const note = (balance: bigint, deposit = 0): INote => ({
  balance, value: balance, deposit, withdraw: 0, assetAddress: asset, approved: true,
  label: BigInt(deposit + 1), precommitment: BigInt(deposit + 1), depositor: 5n, blockNumber: 1n,
});
const plan = (balances: bigint[], amount: bigint, obfuscateAmounts = true) =>
  planPPv1BatchWithdrawal(balances.map(note), asset, amount, { obfuscateAmounts });

afterEach(() => vi.restoreAllMocks());

describe('batch amount planning', () => {
  it('previews full spends and suggests a gross amount without consuming randomness', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const result = plan([1100n, 150n, 100n], 1350n, false);
    expect(result.notes.map(n => n.withdrawnValue)).toEqual([1100n, 150n, 100n]);
    expect(result.fullySpentNoteCount).toBe(3);
    expect(result.suggestedAmount).toBe(1282n);
    expect(result.maxObfuscatedAmount).toBe(1336n);
    expect(random).not.toHaveBeenCalled();
  });

  it('preserves the discussion’s 1.25 total while leaving change on all three notes', () => {
    const balances = ['0.1', '0.15', '1.1'].map(value => parseEther(value));
    const amount = parseEther('1.25');
    for (let i = 0; i < 30; i++) {
      const result = plan(balances, amount);
      expect(result.notes).toHaveLength(3);
      expect(result.notes.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(amount);
      expect(result.fullySpentNoteCount).toBe(0);
      for (const entry of result.notes) {
        expect(entry.withdrawnValue).toBeGreaterThan(0n);
        expect(entry.changeValue * 100n).toBeGreaterThanOrEqual(entry.note.balance);
        expect(entry.changeValue + entry.withdrawnValue).toBe(entry.note.balance);
      }
      for (const entry of result.notes.slice(0, -1)) {
        expect(entry.changeValue * 100n).toBeLessThanOrEqual(entry.note.balance * 5n);
      }
    }
  });

  it('rejects a full multi-note spend with a structured suggestion, and allows explicit opt-out', () => {
    expect(() => plan([1000n, 1000n], 2000n)).toThrow(PPv1AmountObfuscationError);
    try { plan([1000n, 1000n], 2000n); } catch (error) {
      expect(error).toMatchObject({ requestedAmount: 2000n, maxObfuscatedAmount: 1980n, suggestedAmount: 1900n });
    }
    expect(plan([1000n, 1000n], 2000n, false).fullySpentNoteCount).toBe(2);
  });

  it('can add a spare note instead of draining the original minimal set', () => {
    const result = plan([1000n, 1000n, 1000n], 1990n);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(1990n);
    expect(result.fullySpentNoteCount).toBe(0);
  });

  it('fits requests right at the 1% capacity without random failures', () => {
    const result = plan([1000n, 1000n], 1980n);
    expect(result.notes.map(n => n.changeValue)).toEqual([10n, 10n]);
  });

  it('keeps single-note batches unchanged', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
    expect(plan([1000n, 500n], 1000n).notes.map(n => n.withdrawnValue)).toEqual([1000n]);
    expect(random).not.toHaveBeenCalled();
  });

  it('ignores spent, unapproved and other-asset notes without mutating the input', () => {
    const input = [note(1000n, 1), { ...note(99999n, 2), approved: false },
      { ...note(99999n, 3), assetAddress: 2n }, note(0n, 4), note(500n, 5)];
    const before = structuredClone(input);
    const result = planPPv1BatchWithdrawal(input, asset, 1400n, { obfuscateAmounts: true });
    expect(result.notes.map(n => n.note.deposit)).toEqual([1, 5]);
    expect(input).toEqual(before);
  });

  it('handles integer rounding and excludes notes too small to leave change', () => {
    const result = plan([1n, 3n, 3n], 4n);
    expect(result.notes.map(n => n.withdrawnValue)).toEqual([2n, 2n]);
    expect(result.notes.map(n => n.changeValue)).toEqual([1n, 1n]);
    expect(() => plan([1n, 1n], 2n)).toThrow(PPv1AmountObfuscationError);
  });

  it('uses fresh cryptographic draws, including rejection of out-of-range bytes', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
    random.mockImplementationOnce((buffer) => { (buffer as Uint8Array).fill(255); return buffer; });
    random.mockImplementationOnce((buffer) => { (buffer as Uint8Array).fill(0); return buffer; });
    const first = plan([1000n, 1000n], 1900n);
    expect(first.notes[0]!.withdrawnValue).toBe(990n);
    expect(random.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves arbitrary-precision totals far beyond Number.MAX_SAFE_INTEGER', () => {
    const balance = 10n ** 60n;
    const amount = balance * 19n / 10n;
    const result = plan([balance, balance], amount);
    expect(result.notes.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(amount);
    expect(result.fullySpentNoteCount).toBe(0);
  });

  it('never suggests increasing a partial request', () => {
    expect(plan([1000n, 1000n], 1001n, false).suggestedAmount).toBe(1001n);
  });

  it('conserves totals and leaves integer change across small balances and tight budgets', () => {
    for (let a = 2n; a <= 12n; a++) {
      for (let b = 2n; b <= a; b++) {
        for (let amount = a + 1n; amount <= a + b - 2n; amount++) {
          const result = plan([a, b], amount);
          expect(result.notes.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(amount);
          expect(result.notes.every(n => n.changeValue > 0n && n.withdrawnValue > 0n)).toBe(true);
        }
      }
    }
  });

  it.each([0n, -1n, 3000n])('rejects invalid or unaffordable amounts: %s', amount => {
    expect(() => plan([1000n, 1000n], amount)).toThrow();
  });
});
