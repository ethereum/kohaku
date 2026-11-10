import { describe, expect, it, vi } from 'vitest';
import { toHex } from 'viem';
import * as pp from '../../src/paymaster/gas-bounds';
import * as tc from '../../../tornado-cash/src/paymaster/gas-bounds';

const baseline = {
  callGasLimit: 300_000n, preVerificationGas: 100_000n, verificationGasLimit: 50_000n,
  paymasterVerificationGasLimit: 450_000n, paymasterPostOpGasLimit: 50_000n,
};
const GWEI = 10n ** 9n;
const feeHistory = (tips: bigint[], baseFeePerGas = GWEI) => ({
  oldestBlock: '0x1',
  reward: tips.map(tip => [toHex(tip)]),
  baseFeePerGas: [...tips.map(() => toHex(baseFeePerGas)), toHex(100n * GWEI)],
  gasUsedRatio: tips.map(() => 0.5),
});

describe.each([{ name: 'Privacy Pools', policy: pp }, { name: 'Tornado', policy: tc }])('$name gas bounds', ({ policy }) => {
  it('uses the latest host block and allows an unsupported tip method', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x3b9aca00' };

      throw new Error('Unsupported method');
    });
    const reference = await policy.readGasFeeReference({ request } as never);

    expect(request).toHaveBeenCalledWith({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    expect(reference).toEqual({ baseFeePerGas: GWEI, maxPriorityFeePerGas: 0n });
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 2n * GWEI }, reference)).not.toThrow();
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 6n * GWEI, maxPriorityFeePerGas: 2n * GWEI }, reference)).toThrow('host RPC bounds');
  });

  it('fails closed without a fee reference and rejects malformed prices', async () => {
    await expect(policy.readGasFeeReference({ request: async () => ({}) } as never)).rejects.toThrow('base fee');
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 1n, maxPriorityFeePerGas: 2n }, { baseFeePerGas: 1n, maxPriorityFeePerGas: 0n })).toThrow('invalid gas prices');
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: -1n, maxPriorityFeePerGas: 0n }, { baseFeePerGas: 1n, maxPriorityFeePerGas: 0n })).toThrow('invalid gas prices');
  });

  it('bounds the tip independently, even if maxFeePerGas is acceptable', () => {
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: 4n * GWEI }, { baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: GWEI })).toThrow('host RPC bounds');
  });

  it.each([0, 9])('uses the highest per-block p90, including a spike at index %i', async spikeIndex => {
    const tips = Array.from({ length: 10 }, (_, index) => index === spikeIndex ? 4n * GWEI : 15_166n);
    const request = vi.fn(async () => feeHistory(tips));
    const reference = await policy.readGasFeeReference({ request } as never);

    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'eth_feeHistory', params: ['0xa', 'latest', [90]] });
    expect(reference).toEqual({ baseFeePerGas: GWEI, maxPriorityFeePerGas: 4n * GWEI });
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 8n * GWEI, maxPriorityFeePerGas: 4n * GWEI }, reference)).not.toThrow();
  });

  it('accepts a shorter available history and zero rewards for empty blocks', async () => {
    const reference = await policy.readGasFeeReference({ request: async () => feeHistory([0n, 0n]) } as never);

    expect(reference).toEqual({ baseFeePerGas: GWEI, maxPriorityFeePerGas: 0n });
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 2n * GWEI }, reference)).not.toThrow();
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 2n * GWEI + 1n }, reference)).toThrow('host RPC bounds');
  });

  it.each([
    { label: 'null', history: null },
    { label: 'missing rewards', history: { baseFeePerGas: ['0x1', '0x1'] } },
    { label: 'empty history', history: feeHistory([]) },
    { label: 'too many blocks', history: feeHistory(Array(11).fill(100n * GWEI)) },
    { label: 'inconsistent lengths', history: { reward: [['0x1']], baseFeePerGas: ['0x1'] } },
    { label: 'missing percentile', history: { ...feeHistory([GWEI]), reward: [[]] } },
    { label: 'extra percentiles', history: { ...feeHistory([GWEI]), reward: [['0x1', '0x2']] } },
    { label: 'null tip', history: { ...feeHistory([GWEI]), reward: [[null]] } },
    { label: 'negative tip', history: { ...feeHistory([GWEI]), reward: [['-1']] } },
    { label: 'unparseable tip', history: { ...feeHistory([GWEI]), reward: [['oops']] } },
    { label: 'invalid base fee', history: { ...feeHistory([GWEI]), baseFeePerGas: [null, '0x1'] } },
  ])('uses the conservative fallback for $label, never the hard cap', async ({ history }) => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_feeHistory') return history;

      if (method === 'eth_getBlockByNumber') return { baseFeePerGas: toHex(GWEI) };

      return toHex(15_166n);
    });
    const reference = await policy.readGasFeeReference({ request } as never);

    expect(reference).toEqual({ baseFeePerGas: GWEI, maxPriorityFeePerGas: 15_166n });
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 6n * GWEI, maxPriorityFeePerGas: 3n * GWEI }, reference)).toThrow('host RPC bounds');
  });

  it('also caps a high fallback RPC suggestion at 20 gwei', async () => {
    const request = async ({ method }: { method: string }) => {
      if (method === 'eth_feeHistory') throw new Error('Unsupported method');

      if (method === 'eth_getBlockByNumber') return { baseFeePerGas: toHex(10n * GWEI) };

      return toHex(100n * GWEI);
    };
    const reference = await policy.readGasFeeReference({ request } as never);

    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 50n * GWEI, maxPriorityFeePerGas: 20n * GWEI }, reference)).not.toThrow();
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: 50n * GWEI, maxPriorityFeePerGas: 20n * GWEI + 1n }, reference)).toThrow('host RPC bounds');
  });

  it.each([
    { tip: 0n, cap: 2n * GWEI },
    { tip: GWEI, cap: 3n * GWEI },
    { tip: 4n * GWEI, cap: 12n * GWEI },
    { tip: 7n * GWEI, cap: 20n * GWEI },
    { tip: 100n * GWEI, cap: 20n * GWEI },
  ])('enforces both independent price ceilings for reference tip $tip', ({ tip, cap }) => {
    const reference = { baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: tip };
    const feeCap = 30n * GWEI + cap;

    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: feeCap, maxPriorityFeePerGas: cap }, reference)).not.toThrow();
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: feeCap, maxPriorityFeePerGas: cap + 1n }, reference)).toThrow('host RPC bounds');
    expect(() => policy.assertGasPriceWithinBounds({ maxFeePerGas: feeCap + 1n, maxPriorityFeePerGas: cap }, reference)).toThrow('host RPC bounds');
  });

  it('reports the requested prices and both ceilings in wei', () => {
    expect(() => policy.assertGasPriceWithinBounds(
      { maxFeePerGas: 50n * GWEI, maxPriorityFeePerGas: 21n * GWEI },
      { baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 100n * GWEI },
    )).toThrow('requested: maxFeePerGas=50000000000, maxPriorityFeePerGas=21000000000; limits: maxFeePerGas=50000000000, maxPriorityFeePerGas=20000000000; all in wei');
  });

  it('fails closed when neither history nor a valid latest base fee is available', async () => {
    await expect(policy.readGasFeeReference()).rejects.toThrow('host provider');
    const request = async ({ method }: { method: string }) => method === 'eth_feeHistory' ? null : { baseFeePerGas: 'invalid' };

    await expect(policy.readGasFeeReference({ request } as never)).rejects.toThrow('Invalid host gas price reference');
  });

  it('does not reinterpret a tail-call estimate as an execution ceiling', () => {
    expect(() => policy.assertGasLimitsWithinBounds({ ...baseline, callGasLimit: 10_000_000n }, baseline)).not.toThrow();
    expect(() => policy.assertGasLimitsWithinBounds({ ...baseline, callGasLimit: 10_000_000n }, baseline, undefined, { callGasLimit: 5_000_000n })).toThrow('callGasLimit');
  });

  it('grows pre-verification ceilings with actual payload bytes', () => {
    const gas = { ...baseline, preVerificationGas: 1_000_000n };

    expect(() => policy.assertGasLimitsWithinBounds(gas, baseline)).toThrow('preVerificationGas');
    expect(() => policy.assertGasLimitsWithinBounds(gas, baseline, { callData: `0x${'11'.repeat(10_000)}`, paymasterData: '0x' } as never)).not.toThrow();
  });

  it('permits an explicit deployment-specific overhead ceiling and rejects invalid ceilings', () => {
    const gas = { ...baseline, paymasterVerificationGasLimit: 1_000_000n };

    expect(() => policy.assertGasLimitsWithinBounds(gas, baseline)).toThrow('paymasterVerificationGasLimit');
    expect(() => policy.assertGasLimitsWithinBounds(gas, baseline, undefined, { paymasterVerificationGasLimit: 1_200_000n })).not.toThrow();
    expect(() => policy.assertGasLimitsWithinBounds(gas, baseline, undefined, { callGasLimit: -1n })).toThrow('Invalid');
  });
});
