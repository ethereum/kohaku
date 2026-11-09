import { describe, expect, it, vi } from 'vitest';
import { HttpRequestError, RpcRequestError, recoverTypedDataAddress, size, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address, getUserOperationTypedData } from 'viem/account-abstraction';
import type { SerializedUserOperation, UserOpGasLimits } from '../../src/interfaces/user-ops.interface';
import { buildEstimatedTornadoUserOp } from '../../src/paymaster/estimate';
import { encodePoolPaymasterData } from '../../src/paymaster/config';
import { computeMinimumViableFee, reasonableGasUnits, reasonableGasUnitsForBatch } from '../../src/paymaster/fee';
import { buildSignedTornadoUserOp } from '../../src/paymaster/utils';
import type { TornadoProveOutput } from '../../src/utils/tornado-prover';

const baseline = { ...reasonableGasUnits(false), callGasLimit: 0n };
const signer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const paymaster = '0x0000000000000000000000000000000000000002';
const recipient = '0x0000000000000000000000000000000000000003';

function builder(consolidated = false, isERC20 = false) {
  return vi.fn(async (gas: UserOpGasLimits) => {
    const fee = computeMinimumViableFee(gas, 2n) * (isERC20 ? 7n : 1n);
    const proof: TornadoProveOutput = {
      proof: '0x1234',
      args: [toHex(1n, { size: 32 }), toHex(2n, { size: 32 }), consolidated ? signer.address : recipient, paymaster, toHex(fee), '0x00'],
    };
    const userOperation = await buildSignedTornadoUserOp({
      signer, chainId: 11155111, paymasterAddress: paymaster,
      paymasterData: encodePoolPaymasterData(1n, proof), gas,
      maxFeePerGas: 2n, maxPriorityFeePerGas: 1n,
      ...(consolidated ? { tailCalls: async () => [{ to: recipient, data: '0x', value: 10n ** 18n - fee }] } : {}),
    });

    return { proof, userOperation, fee };
  });
}

function rawOperation(op: SerializedUserOperation) {
  return {
    ...op, nonce: BigInt(op.nonce), callGasLimit: BigInt(op.callGasLimit),
    verificationGasLimit: BigInt(op.verificationGasLimit), preVerificationGas: BigInt(op.preVerificationGas),
    maxFeePerGas: BigInt(op.maxFeePerGas), maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
    paymasterVerificationGasLimit: BigInt(op.paymasterVerificationGasLimit!),
    paymasterPostOpGasLimit: BigInt(op.paymasterPostOpGasLimit!),
  };
}

describe('Tornado paymaster gas estimation', () => {
  it('rebuilds at a higher execution probe, then tightens and re-estimates the exact signed fee', async () => {
    const base = { ...reasonableGasUnits(false), callGasLimit: 300_000n };
    const build = builder(true);
    const estimate = vi.fn(async (op: SerializedUserOperation) => {
      if (BigInt(op.callGasLimit) < 500_000n) throw new RpcRequestError({ url: 'unused', body: { paymaster }, error: { code: -32521, message: 'Execution out of gas' } });
      return { ...base, callGasLimit: 450_000n };
    });
    const result = await buildEstimatedTornadoUserOp(base, build, estimate, { executionGasRetryLimit: 800_000n });
    expect(build.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n, 540_000n]);
    expect(BigInt(result.userOperation.callGasLimit)).toBe(540_000n);
    expect(estimate).toHaveBeenLastCalledWith(result.userOperation);
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.userOperation.signature).not.toBe((await build.mock.results[0]!.value).userOperation.signature);
    expect(result.fee).toBe(computeMinimumViableFee(build.mock.calls.at(-1)![0], 2n));
    expect(result.gasEstimation.status).toBe('estimated');
  });

  it.each(['Insufficient funds', 'ERC20: insufficient allowance', 'AA23 reverted: out of gas', 'Unknown error', 'gas required exceeds allowance'])('never increases execution gas for %s', async message => {
    const base = reasonableGasUnitsForBatch(false, 0, true), build = builder(true), estimate = vi.fn().mockRejectedValue(new Error(message));
    await expect(buildEstimatedTornadoUserOp(base, build, estimate, { executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(build).toHaveBeenCalledOnce();
  });

  it('does not downgrade a failed execution retry into unestimated fallback', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, true), build = builder(true);
    const unavailable = new RpcRequestError({ url: 'unused', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    const estimate = vi.fn().mockRejectedValueOnce(new Error('Execution out of gas')).mockRejectedValue(unavailable);

    await expect(buildEstimatedTornadoUserOp(base, build, estimate, { allowFallback: true, executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(build.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n]);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('never probes above the explicit ceiling or retries a zero-execution operation', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, true), build = builder(true), estimate = vi.fn().mockRejectedValue(new Error('Execution out of gas'));
    await expect(buildEstimatedTornadoUserOp(base, build, estimate, { executionGasRetryLimit: 700_000n })).rejects.toThrow('preparation stopped');
    expect(build.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n, 700_000n]);
    const direct = builder();
    await expect(buildEstimatedTornadoUserOp(baseline, direct, estimate, { executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(direct).toHaveBeenCalledOnce();
  });

  it('caps gas-shortage probes at three and honors validation before another proof', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, true), build = builder(true), estimate = vi.fn().mockRejectedValue(new Error('Execution out of gas'));
    await expect(buildEstimatedTornadoUserOp(base, build, estimate, { executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(build.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n, 1_200_000n, 2_400_000n]);
    const bounded = builder(true);
    await expect(buildEstimatedTornadoUserOp(base, bounded, estimate, { executionGasRetryLimit: 8_000_000n,
      validateGas: gas => { if (gas.callGasLimit > 500_000n) throw new Error('Absolute ceiling'); } })).rejects.toThrow('Absolute ceiling');
    expect(bounded).toHaveBeenCalledOnce();
  });

  it.each([false, true])('rebuilds the 100000 -> 281260 budget with matching fee/proof/signature (ERC20=%s)', async (isERC20) => {
    const build = builder(false, isERC20);
    const estimate = vi.fn(async () => ({ ...baseline, preVerificationGas: 281_260n, callGasLimit: 9_000n }));
    const result = await buildEstimatedTornadoUserOp(baseline, build, estimate);

    expect(build).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenLastCalledWith(result.userOperation);
    expect(result.userOperation.preVerificationGas).toBe(toHex(337_512n));
    expect(result.userOperation.callGasLimit).toBe('0x0');
    expect(result.fee).toBeGreaterThan((await build.mock.results[0]!.value).fee);
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBe(computeMinimumViableFee(build.mock.calls[1]![0], 2n) * (isERC20 ? 7n : 1n));
    expect(await recoverTypedDataAddress({
      ...getUserOperationTypedData({ chainId: 11155111, entryPointAddress: entryPoint08Address, userOperation: rawOperation(result.userOperation) }),
      signature: result.userOperation.signature,
    })).toBe(signer.address);
  });

  it('rebuilds consolidated forwarding calldata and the sponsoring proof', async () => {
    const base = reasonableGasUnitsForBatch(false, 2, false);
    const build = builder(true);
    const estimate = vi.fn(async () => ({ ...base, preVerificationGas: 281_260n }));
    const result = await buildEstimatedTornadoUserOp(base, build, estimate);
    const original = await build.mock.results[0]!.value;

    expect(build).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenLastCalledWith(result.userOperation);
    expect(result.userOperation.callGasLimit).not.toBe('0x0');
    expect(result.userOperation.callData).not.toBe(original.userOperation.callData);
    expect(result.userOperation.paymasterData).not.toBe(original.userOperation.paymasterData);
    expect(result.userOperation.signature).not.toBe(original.userOperation.signature);
  });

  it('estimates again after rebuilding and handles further increases', async () => {
    const build = builder();
    const estimate = vi.fn().mockResolvedValueOnce({ ...baseline, preVerificationGas: 200_000n })
      .mockResolvedValue({ ...baseline, preVerificationGas: 281_260n });
    const result = await buildEstimatedTornadoUserOp(baseline, build, estimate);

    expect(build).toHaveBeenCalledTimes(3);
    expect(estimate).toHaveBeenLastCalledWith(result.userOperation);
    expect(result.userOperation.preVerificationGas).toBe(toHex(337_512n));
  });

  it('never returns fallback gas when the first or final estimate fails', async () => {
    const cause = Object.assign(new Error('RPC request failed'), { details: 'bundler unavailable' });

    await expect(buildEstimatedTornadoUserOp(baseline, builder(), vi.fn().mockRejectedValue(cause))).rejects.toThrow('bundler unavailable');
    const afterRebuild = vi.fn().mockResolvedValueOnce({ ...baseline, preVerificationGas: 281_260n }).mockRejectedValue(cause);

    await expect(buildEstimatedTornadoUserOp(baseline, builder(), afterRebuild)).rejects.toThrow('preparation stopped');
  });

  it('retries a temporary final-estimate failure without re-proving or altering the signed payload', async () => {
    const build = builder(true);
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const estimated = { ...base, preVerificationGas: 281_260n };
    const estimate = vi.fn()
      .mockResolvedValueOnce(estimated)
      .mockRejectedValueOnce(new HttpRequestError({ url: 'https://bundler.invalid', status: 503 }))
      .mockResolvedValueOnce(estimated);
    const result = await buildEstimatedTornadoUserOp(base, build, estimate);

    expect(build).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenCalledTimes(3);
    expect(estimate.mock.calls[1]![0]).toBe(result.userOperation);
    expect(estimate.mock.calls[2]![0]).toBe(result.userOperation);
  });

  it('returns a marked payload-sized fallback with a newly bound fee, proof and signature when eligible', async () => {
    const build = builder(true);
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    const estimate = vi.fn().mockRejectedValue(failure);
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const result = await buildEstimatedTornadoUserOp(base, build, estimate, { allowFallback: true });
    const original = await build.mock.results[0]!.value;
    const expected = 350_000n + 40n * BigInt(size(result.userOperation.callData) + size(result.userOperation.paymasterData!));

    expect(result.gasEstimation.status).toBe('fallback');
    expect(result.gasEstimation).toMatchObject({ reason: 'bundler-internal' });
    expect(BigInt(result.userOperation.preVerificationGas)).toBe(expected);
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBeGreaterThan(original.fee);
    expect(result.userOperation.callData).not.toBe(original.userOperation.callData);
    expect(result.userOperation.signature).not.toBe(original.userOperation.signature);
    expect(await recoverTypedDataAddress({
      ...getUserOperationTypedData({ chainId: 11155111, entryPointAddress: entryPoint08Address, userOperation: rawOperation(result.userOperation) }),
      signature: result.userOperation.signature,
    })).toBe(signer.address);
    // The marked fallback is deliberately not represented as estimated.
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(estimate.mock.calls[0]![0]).toBe(original.userOperation);
  });

  it.each([false, true])('rebinds the direct fallback fee, proof and signature to the validation budget (ERC20=%s)', async isERC20 => {
    const base = { ...reasonableGasUnits(isERC20), callGasLimit: 0n };
    const build = builder(false, isERC20);
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: {
      code: -32501, message: 'AA33 reverted 0x54107e370000000000000000000000000000000000000000000000000000000000989680',
    } });
    const result = await buildEstimatedTornadoUserOp(base, build, vi.fn().mockRejectedValue(failure), { allowFallback: true, isERC20 });
    const original = await build.mock.results[0]!.value;

    expect(build).toHaveBeenCalledTimes(2);
    expect(BigInt(result.userOperation.paymasterVerificationGasLimit!)).toBe(isERC20 ? 1_200_000n : 650_000n);
    expect(BigInt(result.userOperation.preVerificationGas)).toBe(300_000n);
    expect(BigInt(result.userOperation.verificationGasLimit)).toBe(150_000n);
    expect(BigInt(result.userOperation.paymasterPostOpGasLimit!)).toBe(50_000n);
    expect(result.userOperation.callData).toBe('0x');
    expect(result.userOperation.callGasLimit).toBe('0x0');
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBe(computeMinimumViableFee(build.mock.calls[1]![0], 2n) * (isERC20 ? 7n : 1n));
    expect(result.fee).toBeGreaterThan(original.fee);
    expect(result.userOperation.paymasterData).not.toBe(original.userOperation.paymasterData);
    expect(result.userOperation.signature).not.toBe(original.userOperation.signature);
    expect(await recoverTypedDataAddress({
      ...getUserOperationTypedData({ chainId: 11155111, entryPointAddress: entryPoint08Address, userOperation: rawOperation(result.userOperation) }),
      signature: result.userOperation.signature,
    })).toBe(signer.address);
  });

  it('preserves already-refined limits if availability fails after an earlier successful estimate', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    const estimate = vi.fn().mockResolvedValueOnce({ ...base, preVerificationGas: 700_000n, callGasLimit: 400_000n }).mockRejectedValue(failure);
    const result = await buildEstimatedTornadoUserOp(base, builder(true), estimate, { allowFallback: true });

    expect(result.gasEstimation.status).toBe('fallback');
    expect(BigInt(result.userOperation.preVerificationGas)).toBe(840_000n);
    expect(BigInt(result.userOperation.callGasLimit)).toBe(480_000n);
  });

  it.each([
    { code: -32500, message: 'AA33 reverted' },
    { code: -32500, message: 'preVerificationGas is not enough, required: 281260, got: 100000' },
    { code: -32603, message: 'AA33 reverted 0x1234' },
    { code: -32603, message: 'Internal error' },
  ])('does not fallback on known invalidity or an unclassified RPC error: $message', async (error) => {
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error });
    const build = builder(true);

    await expect(buildEstimatedTornadoUserOp(reasonableGasUnitsForBatch(false, 0, false), build, vi.fn().mockRejectedValue(failure), { allowFallback: true })).rejects.toThrow('preparation stopped');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('retains baseline floors when estimates omit paymaster gas', async () => {
    const build = builder();
    const result = await buildEstimatedTornadoUserOp(baseline, build, async () => ({
      callGasLimit: 0n, verificationGasLimit: 1n, preVerificationGas: 1n,
      paymasterVerificationGasLimit: 0n, paymasterPostOpGasLimit: 0n,
    }));

    expect(build).toHaveBeenCalledTimes(1);
    expect(BigInt(result.userOperation.paymasterVerificationGasLimit!)).toBe(450_000n);
    expect(BigInt(result.userOperation.paymasterPostOpGasLimit!)).toBe(50_000n);
  });

  it('rejects invalid estimates and stops after bounded non-convergence', async () => {
    await expect(buildEstimatedTornadoUserOp(baseline, builder(), async () => ({ ...baseline, preVerificationGas: 0n }))).rejects.toThrow('invalid gas estimates');
    const build = builder();
    const estimate = vi.fn(async (op: SerializedUserOperation) => ({ ...baseline, preVerificationGas: BigInt(op.preVerificationGas) * 2n }));

    await expect(buildEstimatedTornadoUserOp(baseline, build, estimate)).rejects.toThrow('did not stabilize after 3 attempts');
    expect(build).toHaveBeenCalledTimes(3);
    expect(estimate).toHaveBeenCalledTimes(3);
  });
});
