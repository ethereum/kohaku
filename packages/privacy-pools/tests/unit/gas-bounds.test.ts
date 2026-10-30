import { describe, expect, it, vi } from 'vitest';
import * as pp from '../../src/paymaster/gas-bounds';
import * as tc from '../../../tornado-cash/src/paymaster/gas-bounds';

const baseline = {
  callGasLimit: 300_000n, preVerificationGas: 100_000n, verificationGasLimit: 50_000n,
  paymasterVerificationGasLimit: 450_000n, paymasterPostOpGasLimit: 50_000n,
};
const GWEI = 10n ** 9n;

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
