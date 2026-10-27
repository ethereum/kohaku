import { unwrapResult } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toHex } from 'viem';
import type { SerializedUserOperation } from '../../src/interfaces/user-ops.interface';
import { reasonableGasUnits, reasonableGasUnitsForBatch } from '../../src/paymaster/fee';
import { storeFactory } from '../../src/state/store';
import { paymasterWithdrawThunk } from '../../src/state/thunks/paymasterWithdrawThunk';

const fixture = vi.hoisted(() => ({
  isERC20: false,
  count: 1,
  fees: [] as bigint[],
  quote: vi.fn(async (_paymaster: bigint, _asset: bigint, fee: bigint) => fee * 7n),
  estimate: vi.fn(),
}));

vi.mock('../../src/state/selectors/slices.selectors', () => ({
  instanceRegistryInfoSelector: () => ({ chainId: 11155111n }),
  poolsSelector: () => new Map([[1n, { denomination: 10n ** 18n, isERC20: fixture.isERC20, asset: fixture.isERC20 ? 2n : 0n }]]),
}));
vi.mock('../../src/state/selectors/withdrawals.selector', () => ({
  getWithdrawableDepositsSelector: () => Array.from({ length: fixture.count }, () => ({ pool: 1n })),
}));
vi.mock('../../src/state/thunks/verifyRootsThunk', () => ({
  verifyRootsThunk: () => async () => ({ payload: undefined }),
}));
vi.mock('../../src/state/thunks/withdrawalsProofThunk', () => ({
  withdrawalsProofThunk: (params: { fee: bigint; recipient: bigint; relayerAddress: bigint }) => async () => {
    fixture.fees.push(params.fee);
    return { payload: { proof: '0x1234', args: [toHex(1n, { size: 32 }), toHex(2n, { size: 32 }), toHex(params.recipient, { size: 20 }), toHex(params.relayerAddress, { size: 20 }), toHex(params.fee), '0x00'] } };
  },
}));
vi.mock('../../src/paymaster/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/paymaster/utils')>(),
  createPaymasterBundlerClient: () => ({}),
  getUserOperationGasPrice: async () => ({ standard: { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } }),
  estimateUserOperationGas: (_client: unknown, op: SerializedUserOperation) => fixture.estimate(op),
}));

async function prepare() {
  const store = storeFactory({ logLevel: 'off' });
  return unwrapResult(await store.dispatch(paymasterWithdrawThunk({
    dataService: { getChainId: async () => 11155111n, quoteWeiInToken: fixture.quote },
    assetAddress: fixture.isERC20 ? 2n : 0n,
    amount: BigInt(fixture.count) * 10n ** 18n,
    recipient: 3n,
    secretManager: {},
    paymasterSettings: { 11155111: {
      paymasterAddress: '0x0000000000000000000000000000000000000004',
      entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108', bundlerUrl: 'unused',
      supportedPools: ['0x0000000000000000000000000000000000000001'],
    }, delegation: { mode: 'random' } },
    proverFactory: async () => ({}),
  } as never)));
}

describe('paymaster withdrawal preparation integration', () => {
  beforeEach(() => {
    fixture.fees = [];
    fixture.quote.mockClear();
    fixture.estimate.mockReset();
  });

  it.each([
    { count: 1, isERC20: false }, { count: 2, isERC20: false },
    { count: 1, isERC20: true }, { count: 2, isERC20: true },
  ])('rebuilds and validates the final payload for $count note(s), ERC20=$isERC20', async ({ count, isERC20 }) => {
    fixture.count = count;
    fixture.isERC20 = isERC20;
    const gas = count === 1 ? { ...reasonableGasUnits(isERC20), callGasLimit: 0n } : reasonableGasUnitsForBatch(isERC20, count - 1, false);
    fixture.estimate.mockResolvedValue({ ...gas, preVerificationGas: 281_260n });
    const withdrawals = await prepare();
    const withdrawal = withdrawals[0]!;
    expect(withdrawal.mode).toBe('paymaster');
    if (withdrawal.mode !== 'paymaster') throw new Error('Expected paymaster payload');
    expect(fixture.estimate).toHaveBeenCalledTimes(2);
    expect(fixture.estimate).toHaveBeenLastCalledWith(withdrawal.userOperation);
    expect(BigInt(withdrawal.userOperation.preVerificationGas)).toBe(337_512n);
    const sponsoringFees = fixture.fees.filter((fee) => fee > 0n);
    expect(sponsoringFees).toHaveLength(2);
    expect(sponsoringFees[1]).toBeGreaterThan(sponsoringFees[0]!);
    expect(BigInt(withdrawal.proof.args[4])).toBe(sponsoringFees[1]);
    expect(withdrawal.userOperation.callData === '0x').toBe(count === 1);
    expect(fixture.quote).toHaveBeenCalledTimes(isERC20 ? 2 : 0);
  });

  it('rejects preparation instead of returning a baseline signed operation', async () => {
    fixture.count = 1;
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new Error('bundler is offline'));
    await expect(prepare()).rejects.toMatchObject({ message: expect.stringContaining('gas estimation failed: bundler is offline') });
  });
});
