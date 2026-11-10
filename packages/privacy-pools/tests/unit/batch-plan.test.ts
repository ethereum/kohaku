import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEther } from 'viem';
import type { INote } from '../../src/plugin/interfaces/protocol-params.interface';
import { planObfuscatedBatchWithdrawal, PPv1AmountObfuscationError } from '../../src/withdrawal/batch-plan';

const asset = 1n;
const note = (balance: bigint, deposit = 0): INote => ({
  balance, value: balance, deposit, withdraw: 0, assetAddress: asset, approved: true,
  label: BigInt(deposit + 1), precommitment: BigInt(deposit + 1), depositor: 5n, blockNumber: 1n,
});
const plan = (balances: bigint[], amount: bigint) => planObfuscatedBatchWithdrawal(balances.map(note), asset, amount);

afterEach(() => vi.restoreAllMocks());

describe('batch amount allocation', () => {
  it('breaks the original three-deposit amount pattern while preserving the exact request', () => {
    const amount = parseEther('1.25');
    const result = plan(['1', '0.2', '0.123'].map(value => parseEther(value)), amount);

    expect(result).toHaveLength(3);
    expect(result.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(amount);

    for (const entry of result) {
      expect(entry.withdrawnValue).toBeGreaterThan(0n);
      expect((entry.note.balance - entry.withdrawnValue) * 100n).toBeGreaterThanOrEqual(entry.note.balance);
    }

    for (const entry of result.slice(0, -1)) {
      expect((entry.note.balance - entry.withdrawnValue) * 100n).toBeLessThanOrEqual(entry.note.balance * 25n);
    }
  });

  it('accepts the 97% ceiling and preserves exact totals at both extremes of a random draw', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');

    random.mockImplementation(buffer => { (buffer as Uint8Array).fill(0);

 return buffer; });
    expect(plan([1000n, 1000n, 1000n], 2910n).map(n => n.withdrawnValue)).toEqual([930n, 990n, 990n]);
    random.mockImplementationOnce(buffer => { (buffer as Uint8Array).fill(60);

 return buffer; });
    random.mockImplementationOnce(buffer => { (buffer as Uint8Array).fill(60);

 return buffer; });
    expect(plan([1000n, 1000n, 1000n], 2910n).map(n => n.withdrawnValue)).toEqual([990n, 990n, 930n]);
    expect(() => plan([1000n, 1000n, 1000n], 2911n)).toThrow(PPv1AmountObfuscationError);
  });

  it('adds a spare note when the original minimal set cannot leave enough change', () => {
    const result = plan([1000n, 1000n, 1000n], 1990n);

    expect(result).toHaveLength(3);
    expect(result.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(1990n);
    expect(result.every(n => n.withdrawnValue > 0n && n.withdrawnValue < n.note.balance)).toBe(true);
  });

  it('uses one partial note when possible, enforces 1% change, and applies the global ceiling', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');

    for (const amount of [500n, 900n, 970n]) {
      expect(plan([1000n], amount).map(n => n.withdrawnValue)).toEqual([amount]);
    }
    expect(plan([1000n, 1000n], 990n).map(n => n.withdrawnValue)).toEqual([990n]);
    expect(random).not.toHaveBeenCalled();
    expect(() => plan([1000n], 971n)).toThrow(PPv1AmountObfuscationError);
    expect(() => plan([1000n], 1000n)).toThrow(PPv1AmountObfuscationError);
    const result = plan([1000n, 1000n], 1000n);

    expect(result).toHaveLength(2);
    expect(result.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(1000n);
    expect(result.every(n => n.withdrawnValue <= n.note.balance * 99n / 100n)).toBe(true);
  });

  it('ignores spent, unapproved and other-asset notes', () => {
    const input = [note(1000n, 1), { ...note(99999n, 2), approved: false },
      { ...note(99999n, 3), assetAddress: 2n }, note(0n, 4), note(500n, 5)];

    expect(planObfuscatedBatchWithdrawal(input, asset, 1400n).map(n => n.note.deposit)).toEqual([1, 5]);
  });

  it('preserves integer change, allowing deterministic tiny splits only when necessary', () => {
    const result = plan([1n, 101n, 101n], 196n);

    expect(result).toHaveLength(2);
    expect(result.reduce((sum, n) => sum + n.withdrawnValue, 0n)).toBe(196n);
    expect(result.every(n => n.note.balance - n.withdrawnValue >= 2n)).toBe(true);
    expect(() => plan([1n, 101n, 101n], 197n)).toThrow(PPv1AmountObfuscationError);
    expect(plan([3n, 3n], 4n).map(n => n.withdrawnValue)).toEqual([2n, 2n]);
    expect(() => plan([3n, 3n], 5n)).toThrow(PPv1AmountObfuscationError);
    expect(() => plan([1n, 1n], 1n)).toThrow(PPv1AmountObfuscationError);
  });

  it('uses wider random ranges at 90% and 75%, rejecting out-of-range crypto samples', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');

    random.mockImplementationOnce(buffer => { (buffer as Uint8Array).fill(0);

 return buffer; });
    expect(plan([1000n, 1000n], 1800n).map(n => n.withdrawnValue)).toEqual([810n, 990n]);
    random.mockImplementationOnce(buffer => { (buffer as Uint8Array).fill(0);

 return buffer; });
    expect(plan([1000n, 1000n], 1500n).map(n => n.withdrawnValue)).toEqual([750n, 750n]);
    random.mockImplementationOnce(buffer => { (buffer as Uint8Array).fill(255);

 return buffer; });
    random.mockImplementationOnce(buffer => { (buffer as Uint8Array).fill(240);

 return buffer; });
    expect(plan([1000n, 1000n], 1500n).map(n => n.withdrawnValue)).toEqual([990n, 510n]);
    expect(random).toHaveBeenCalledTimes(4);
  });
});
