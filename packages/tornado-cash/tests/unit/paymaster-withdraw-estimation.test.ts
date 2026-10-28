import { unwrapResult } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, toHex } from 'viem';
import type { SerializedUserOperation } from '../../src/interfaces/user-ops.interface';
import { SIMPLE_7702_EXECUTE_ABI } from '../../src/data/abis/account.abi';
import { reasonableGasUnitsForBatch } from '../../src/paymaster/fee';
import { storeFactory } from '../../src/state/store';
import { paymasterWithdrawThunk } from '../../src/state/thunks/paymasterWithdrawThunk';

const fixture = vi.hoisted(() => ({
  isERC20: false,
  count: 1,
  fees: [] as bigint[],
  proofRecipients: [] as bigint[],
  quote: vi.fn(async (_paymaster: bigint, _asset: bigint, fee: bigint) => fee * 7n),
  estimate: vi.fn(),
  deriveSignature: vi.fn(async () => `0x${'01'.repeat(32)}` as const),
  deriveDelegator: vi.fn(async () => `0x${'02'.repeat(32)}` as const),
}));

vi.mock('../../src/state/selectors/slices.selectors', () => ({
  instanceRegistryInfoSelector: () => ({ chainId: 11155111n }),
  poolsSelector: () => new Map([[1n, { denomination: 10n ** 18n, isERC20: fixture.isERC20, asset: fixture.isERC20 ? 2n : 0n }]]),
}));
vi.mock('../../src/state/selectors/withdrawals.selector', () => ({
  getWithdrawableDepositsSelector: () => Array.from({ length: fixture.count }, () => ({ pool: 1n, kind: 'signature', nonce: 0n })),
}));
vi.mock('../../src/state/thunks/verifyRootsThunk', () => ({
  verifyRootsThunk: () => async () => ({ payload: undefined }),
}));
vi.mock('../../src/state/thunks/withdrawalsProofThunk', () => ({
  withdrawalsProofThunk: (params: { fee: bigint; recipient: bigint; relayerAddress: bigint }) => async () => {
    fixture.fees.push(params.fee);
    fixture.proofRecipients.push(params.recipient);
    return { payload: { proof: '0x1234', args: [toHex(1n, { size: 32 }), toHex(2n, { size: 32 }), toHex(params.recipient, { size: 20 }), toHex(params.relayerAddress, { size: 20 }), toHex(params.fee), '0x00'] } };
  },
}));
vi.mock('../../src/paymaster/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/paymaster/utils')>(),
  createPaymasterBundlerClient: () => ({}),
  getUserOperationGasPrice: async () => ({ standard: { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } }),
  estimateUserOperationGas: (_client: unknown, op: SerializedUserOperation) => fixture.estimate(op),
}));

async function prepare(delegation: { mode: 'random' } | { mode: 'deterministic'; path?: string } | null = { mode: 'random' }) {
  const store = storeFactory({ logLevel: 'off' });
  return unwrapResult(await store.dispatch(paymasterWithdrawThunk({
    dataService: { getChainId: async () => 11155111n, quoteWeiInToken: fixture.quote },
    assetAddress: fixture.isERC20 ? 2n : 0n,
    amount: BigInt(fixture.count) * 10n ** 18n,
    recipient: 3n,
    secretManager: { deriveSignatureEphemeralSigner: fixture.deriveSignature, deriveDelegatorSigner: fixture.deriveDelegator },
    paymasterSettings: { 11155111: {
      paymasterAddress: '0x0000000000000000000000000000000000000004',
      entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108', bundlerUrl: 'unused',
      supportedPools: ['0x0000000000000000000000000000000000000001'],
    }, ...(delegation ? { delegation } : {}) },
    proverFactory: async () => ({}),
  } as never)));
}

describe('paymaster withdrawal preparation integration', () => {
  beforeEach(() => {
    fixture.fees = [];
    fixture.proofRecipients = [];
    fixture.quote.mockClear();
    fixture.estimate.mockReset();
    fixture.deriveSignature.mockClear();
    fixture.deriveDelegator.mockClear();
  });

  it.each([
    { count: 1, isERC20: false }, { count: 2, isERC20: false },
    { count: 1, isERC20: true }, { count: 2, isERC20: true },
  ])('rebuilds and validates the final payload for $count note(s), ERC20=$isERC20', async ({ count, isERC20 }) => {
    fixture.count = count;
    fixture.isERC20 = isERC20;
    const gas = reasonableGasUnitsForBatch(isERC20, count - 1, false);
    fixture.estimate.mockImplementation(async (op: SerializedUserOperation) => {
      // The bundler searches execution gas with a 10M ceiling. The paymaster
      // rejects that ceiling if the sponsoring recipient differs from sender.
      const proofRecipient = fixture.proofRecipients.at(-1)!;
      if (proofRecipient !== BigInt(op.sender)) {
        throw new Error('AA33 reverted 0x54107e370000000000000000000000000000000000000000000000000000000000989680');
      }
      return { ...gas, preVerificationGas: 281_260n };
    });
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
    expect(withdrawal.userOperation.callData).not.toBe('0x');
    expect(BigInt(withdrawal.userOperation.callGasLimit)).toBeGreaterThan(0n);
    expect(BigInt(withdrawal.proof.args[2])).toBe(BigInt(withdrawal.userOperation.sender));
    if (count === 1) {
      const call = decodeFunctionData({ abi: SIMPLE_7702_EXECUTE_ABI, data: withdrawal.userOperation.callData });
      expect(call.functionName).toBe('execute');
      expect(BigInt(call.args![0] as string)).toBe(isERC20 ? 2n : 3n);
      if (!isERC20) expect(call.args![1]).toBe(10n ** 18n - BigInt(withdrawal.proof.args[4]));
    }
    expect(fixture.quote).toHaveBeenCalledTimes(isERC20 ? 2 : 0);
  });

  it('keeps the single-note forwarding sender recoverable and honors an explicit wallet path', async () => {
    fixture.count = 1;
    fixture.isERC20 = false;
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, false), preVerificationGas: 281_260n });
    const [noteDerived] = await prepare(null);
    if (noteDerived!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');
    expect(noteDerived!.userOperation.sender).toBe(privateKeyToAccount(`0x${'01'.repeat(32)}`).address);
    expect(fixture.deriveSignature).toHaveBeenCalledWith({ nonce: 0n, chainId: 11155111n, poolAddress: 1n });
    const path = "m/44'/60'/0'/0/3";
    const [walletDerived] = await prepare({ mode: 'deterministic', path });
    if (walletDerived!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');
    expect(walletDerived!.userOperation.sender).toBe(privateKeyToAccount(`0x${'02'.repeat(32)}`).address);
    expect(fixture.deriveDelegator).toHaveBeenCalledWith({ path });
  });

  it('rejects preparation instead of returning a baseline signed operation', async () => {
    fixture.count = 1;
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new Error('bundler is offline'));
    await expect(prepare()).rejects.toMatchObject({ message: expect.stringContaining('gas estimation failed: bundler is offline') });
  });
});
