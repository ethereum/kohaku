import { describe, expect, it, vi } from 'vitest';
import { HttpRequestError, RpcRequestError, recoverTypedDataAddress, size, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address, getUserOperationTypedData } from 'viem/account-abstraction';
import type { SerializedUserOperation, UserOpGasLimits } from '../../src/interfaces/user-ops.interface';
import { buildEstimatedTornadoUserOp } from '../../src/paymaster/estimate';
import { encodePoolPaymasterData } from '../../src/paymaster/config';
import { computeMinimumViableFee, reasonableGasUnits, reasonableGasUnitsForBatch } from '../../src/paymaster/fee';
import { DUMMY_SIGNATURE } from '../../src/paymaster/simulation';
import { buildSignedTornadoUserOp, buildSimulationTornadoUserOp } from '../../src/paymaster/utils';
import type { TornadoProveOutput } from '../../src/utils/tornado-prover';

/** The bundler's answer when the execution phase runs out of gas (ERC-7769 `-32521`). */
const executionOutOfGas = () => new RpcRequestError({ url: 'unused', body: {}, error: { code: -32521, message: 'Execution out of gas' } });

const baseline = { ...reasonableGasUnits(false), callGasLimit: 0n };
const signer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const paymaster = '0x0000000000000000000000000000000000000002';
const recipient = '0x0000000000000000000000000000000000000003';

/** Simulation (dummy proof/signature) and final (proven/signed) builders sharing one fee rule. */
function builder(consolidated = false, isERC20 = false) {
  const simulatedFees: bigint[] = [];
  const assemble = async (gas: UserOpGasLimits, simulation: boolean) => {
    const fee = computeMinimumViableFee(gas, 2n) * (isERC20 ? 7n : 1n);
    const proof: TornadoProveOutput = {
      proof: simulation ? '0xdead' : '0x1234',
      args: [toHex(1n, { size: 32 }), toHex(2n, { size: 32 }), consolidated ? signer.address : recipient, paymaster, toHex(fee), '0x00'],
    };
    const userOperation = await (simulation ? buildSimulationTornadoUserOp : buildSignedTornadoUserOp)({
      signer, chainId: 11155111, entryPointAddress: entryPoint08Address, paymasterAddress: paymaster,
      paymasterData: encodePoolPaymasterData(1n, proof), gas,
      maxFeePerGas: 2n, maxPriorityFeePerGas: 1n,
      ...(consolidated ? { tailCalls: async () => [{ to: recipient, data: '0x', value: 10n ** 18n - fee }] } : {}),
    });

    if (simulation) simulatedFees.push(fee);

    return { proof, userOperation, fee };
  };

  return {
    simulatedFees,
    simulate: vi.fn(async (gas: UserOpGasLimits) => (await assemble(gas, true)).userOperation),
    build: vi.fn((gas: UserOpGasLimits) => assemble(gas, false)),
  };
}

const run = (
  base: UserOpGasLimits,
  { simulate, build }: ReturnType<typeof builder>,
  estimate: (op: SerializedUserOperation) => Promise<UserOpGasLimits>,
  options?: Parameters<typeof buildEstimatedTornadoUserOp>[4],
) => buildEstimatedTornadoUserOp(base, simulate, build, estimate, options);

const recoverSigner = (op: SerializedUserOperation) => recoverTypedDataAddress({
  ...getUserOperationTypedData({ chainId: 11155111, entryPointAddress: entryPoint08Address, userOperation: rawOperation(op) }),
  signature: op.signature,
});

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
  it('only ever sends dummy-signed, dummy-proof simulations to the bundler', async () => {
    const harness = builder(true);
    const estimate = vi.fn().mockResolvedValueOnce({ ...baseline, preVerificationGas: 281_260n, callGasLimit: 300_000n })
      .mockResolvedValue({ ...baseline, preVerificationGas: 1n, callGasLimit: 1n });
    const result = await run(reasonableGasUnitsForBatch(false, 0, false), harness, estimate);

    expect(estimate).toHaveBeenCalledTimes(2);

    for (const [op] of estimate.mock.calls as [SerializedUserOperation][]) {
      expect(op.signature).toBe(DUMMY_SIGNATURE);
      expect(op.eip7702Auth!.r).not.toBe(result.userOperation.eip7702Auth!.r);
      expect(op.paymasterData).not.toBe(result.userOperation.paymasterData);
      expect(await recoverSigner(op)).not.toBe(signer.address);
    }

    expect(harness.build).toHaveBeenCalledOnce();
    expect(await recoverSigner(result.userOperation)).toBe(signer.address);
  });

  it('retains a successful execution probe when the bundler reports a lower estimate', async () => {
    const base = { ...reasonableGasUnits(false), callGasLimit: 600_000n };
    const harness = builder(true);
    const estimate = vi.fn(async (op: SerializedUserOperation) => {
      if (BigInt(op.callGasLimit) < 1_300_000n) throw new RpcRequestError({ url: 'unused', body: { paymaster }, error: { code: -32521, message: 'Execution out of gas' } });

      return { ...base, callGasLimit: 1_000_000n };
    });
    const result = await run(base, harness, estimate, { executionGasRetryLimit: 8_000_000n });

    expect(harness.simulate.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([600_000n, 1_200_000n, 2_400_000n, 2_400_000n]);
    expect(harness.build.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([2_400_000n]);
    expect(BigInt(result.userOperation.callGasLimit)).toBe(2_400_000n);
    expect(estimate).toHaveBeenLastCalledWith(await harness.simulate.mock.results.at(-1)!.value);
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBe(computeMinimumViableFee(harness.build.mock.calls[0]![0], 2n));
    expect(result.gasEstimation.status).toBe('estimated');
  });

  it.each(['Insufficient funds', 'ERC20: insufficient allowance', 'AA23 reverted: out of gas', 'Unknown error', 'gas required exceeds allowance'])('never increases execution gas for %s', async message => {
    const base = reasonableGasUnitsForBatch(false, 0, true), harness = builder(true), estimate = vi.fn().mockRejectedValue(new Error(message));

    await expect(run(base, harness, estimate, { executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(harness.simulate).toHaveBeenCalledOnce();
    expect(harness.build).not.toHaveBeenCalled();
  });

  it('does not downgrade a failed execution retry into unestimated fallback', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, true), harness = builder(true);
    const unavailable = new RpcRequestError({ url: 'unused', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    const estimate = vi.fn().mockRejectedValueOnce(executionOutOfGas()).mockRejectedValue(unavailable);

    await expect(run(base, harness, estimate, { allowFallback: true, executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(harness.simulate.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n]);
    expect(harness.build).not.toHaveBeenCalled();
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('never probes above the explicit ceiling or retries a zero-execution operation', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, true), harness = builder(true), estimate = vi.fn().mockRejectedValue(executionOutOfGas());

    await expect(run(base, harness, estimate, { executionGasRetryLimit: 700_000n })).rejects.toThrow('preparation stopped');
    expect(harness.simulate.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n, 700_000n]);
    const direct = builder();

    await expect(run(baseline, direct, estimate, { executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(direct.simulate).toHaveBeenCalledOnce();
  });

  it('caps gas-shortage probes at three and honors validation before another proof', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, true), harness = builder(true), estimate = vi.fn().mockRejectedValue(executionOutOfGas());

    await expect(run(base, harness, estimate, { executionGasRetryLimit: 8_000_000n })).rejects.toThrow('preparation stopped');
    expect(harness.simulate.mock.calls.map(([gas]) => gas.callGasLimit)).toEqual([300_000n, 600_000n, 1_200_000n, 2_400_000n]);
    const bounded = builder(true);

    await expect(run(base, bounded, estimate, { executionGasRetryLimit: 8_000_000n,
      validateGas: gas => { if (gas.callGasLimit > 500_000n) throw new Error('Absolute ceiling'); } })).rejects.toThrow('Absolute ceiling');
    expect(bounded.simulate).toHaveBeenCalledOnce();
  });

  it.each([false, true])('rebuilds the 100000 -> 281260 budget with matching fee/proof/signature (ERC20=%s)', async (isERC20) => {
    const harness = builder(false, isERC20);
    const estimate = vi.fn(async () => ({ ...baseline, preVerificationGas: 281_260n, callGasLimit: 9_000n }));
    const result = await run(baseline, harness, estimate);

    expect(harness.simulate).toHaveBeenCalledTimes(2);
    expect(harness.build).toHaveBeenCalledOnce();
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenLastCalledWith(await harness.simulate.mock.results[1]!.value);
    expect(result.userOperation.preVerificationGas).toBe(toHex(337_512n));
    expect(result.userOperation.callGasLimit).toBe('0x0');
    expect(result.fee).toBeGreaterThan(harness.simulatedFees[0]!);
    expect(result.fee).toBe(harness.simulatedFees[1]);
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBe(computeMinimumViableFee(harness.build.mock.calls[0]![0], 2n) * (isERC20 ? 7n : 1n));
    expect(await recoverSigner(result.userOperation)).toBe(signer.address);
  });

  it('rebuilds consolidated forwarding calldata and the sponsoring proof', async () => {
    const base = reasonableGasUnitsForBatch(false, 2, false);
    const harness = builder(true);
    const estimate = vi.fn(async () => ({ ...base, preVerificationGas: 281_260n }));
    const result = await run(base, harness, estimate);
    const [first, last] = await Promise.all(harness.simulate.mock.results.map(r => r.value as Promise<SerializedUserOperation>));

    expect(harness.simulate).toHaveBeenCalledTimes(2);
    expect(harness.build).toHaveBeenCalledOnce();
    expect(estimate).toHaveBeenLastCalledWith(last);
    expect(result.userOperation.callGasLimit).not.toBe('0x0');
    expect(result.userOperation.callData).toBe(last!.callData);
    expect(result.userOperation.callData).not.toBe(first!.callData);
    expect(result.userOperation.paymasterData).not.toBe(last!.paymasterData);
    expect(result.userOperation.signature).not.toBe(last!.signature);
  });

  it('estimates again after rebuilding and handles further increases', async () => {
    const harness = builder();
    const estimate = vi.fn().mockResolvedValueOnce({ ...baseline, preVerificationGas: 200_000n })
      .mockResolvedValue({ ...baseline, preVerificationGas: 281_260n });
    const result = await run(baseline, harness, estimate);

    expect(harness.simulate).toHaveBeenCalledTimes(3);
    expect(harness.build).toHaveBeenCalledOnce();
    expect(estimate).toHaveBeenLastCalledWith(await harness.simulate.mock.results[2]!.value);
    expect(result.userOperation.preVerificationGas).toBe(toHex(337_512n));
  });

  it('never returns fallback gas when the first or final estimate fails', async () => {
    const cause = Object.assign(new Error('RPC request failed'), { details: 'bundler unavailable' });

    await expect(run(baseline, builder(), vi.fn().mockRejectedValue(cause))).rejects.toThrow('bundler unavailable');
    const afterRebuild = vi.fn().mockResolvedValueOnce({ ...baseline, preVerificationGas: 281_260n }).mockRejectedValue(cause);
    const harness = builder();

    await expect(run(baseline, harness, afterRebuild)).rejects.toThrow('preparation stopped');
    expect(harness.build).not.toHaveBeenCalled();
  });

  it('retries a temporary final-estimate failure without rebuilding the simulation', async () => {
    const harness = builder(true);
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const estimated = { ...base, preVerificationGas: 281_260n };
    const estimate = vi.fn()
      .mockResolvedValueOnce(estimated)
      .mockRejectedValueOnce(new HttpRequestError({ url: 'https://bundler.invalid', status: 503 }))
      .mockResolvedValueOnce(estimated);
    const result = await run(base, harness, estimate);
    const simulated = await harness.simulate.mock.results[1]!.value;

    expect(harness.simulate).toHaveBeenCalledTimes(2);
    expect(harness.build).toHaveBeenCalledOnce();
    expect(estimate).toHaveBeenCalledTimes(3);
    expect(estimate.mock.calls[1]![0]).toBe(simulated);
    expect(estimate.mock.calls[2]![0]).toBe(simulated);
    expect(result.userOperation.preVerificationGas).toBe(simulated.preVerificationGas);
  });

  it('returns a marked payload-sized fallback with a newly bound fee, proof and signature when eligible', async () => {
    const harness = builder(true);
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    const estimate = vi.fn().mockRejectedValue(failure);
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const result = await run(base, harness, estimate, { allowFallback: true });
    const original = await harness.simulate.mock.results[0]!.value;
    const expected = 350_000n + 40n * BigInt(size(result.userOperation.callData) + size(result.userOperation.paymasterData!));

    expect(result.gasEstimation.status).toBe('fallback');
    expect(result.gasEstimation).toMatchObject({ reason: 'bundler-internal' });
    expect(BigInt(result.userOperation.preVerificationGas)).toBe(expected);
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBeGreaterThan(harness.simulatedFees[0]!);
    expect(result.userOperation.callData).not.toBe(original.callData);
    expect(harness.build).toHaveBeenCalledOnce();
    expect(await recoverSigner(result.userOperation)).toBe(signer.address);
    // The marked fallback is deliberately not represented as estimated.
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(estimate.mock.calls[0]![0]).toBe(original);
  });

  it.each([false, true])('rebinds the direct fallback fee, proof and signature to the validation budget (ERC20=%s)', async isERC20 => {
    const base = { ...reasonableGasUnits(isERC20), callGasLimit: 0n };
    const harness = builder(false, isERC20);
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: {
      code: -32501, message: 'AA33 reverted 0x54107e370000000000000000000000000000000000000000000000000000000000989680',
    } });
    const result = await run(base, harness, vi.fn().mockRejectedValue(failure), { allowFallback: true, isERC20 });

    expect(harness.simulate).toHaveBeenCalledOnce();
    expect(harness.build).toHaveBeenCalledOnce();
    expect(BigInt(result.userOperation.paymasterVerificationGasLimit!)).toBe(isERC20 ? 1_200_000n : 650_000n);
    expect(BigInt(result.userOperation.preVerificationGas)).toBe(300_000n);
    expect(BigInt(result.userOperation.verificationGasLimit)).toBe(150_000n);
    expect(BigInt(result.userOperation.paymasterPostOpGasLimit!)).toBe(50_000n);
    expect(result.userOperation.callData).toBe('0x');
    expect(result.userOperation.callGasLimit).toBe('0x0');
    expect(BigInt(result.proof.args[4])).toBe(result.fee);
    expect(result.fee).toBe(computeMinimumViableFee(harness.build.mock.calls[0]![0], 2n) * (isERC20 ? 7n : 1n));
    expect(result.fee).toBeGreaterThan(harness.simulatedFees[0]!);
    expect(await recoverSigner(result.userOperation)).toBe(signer.address);
  });

  it('preserves already-refined limits if availability fails after an earlier successful estimate', async () => {
    const base = reasonableGasUnitsForBatch(false, 0, false);
    const failure = new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    const estimate = vi.fn().mockResolvedValueOnce({ ...base, preVerificationGas: 700_000n, callGasLimit: 400_000n }).mockRejectedValue(failure);
    const result = await run(base, builder(true), estimate, { allowFallback: true });

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
    const harness = builder(true);

    await expect(run(reasonableGasUnitsForBatch(false, 0, false), harness, vi.fn().mockRejectedValue(failure), { allowFallback: true })).rejects.toThrow('preparation stopped');
    expect(harness.simulate).toHaveBeenCalledOnce();
    expect(harness.build).not.toHaveBeenCalled();
  });

  it('retains baseline floors when estimates omit paymaster gas', async () => {
    const harness = builder();
    const result = await run(baseline, harness, async () => ({
      callGasLimit: 0n, verificationGasLimit: 1n, preVerificationGas: 1n,
      paymasterVerificationGasLimit: 0n, paymasterPostOpGasLimit: 0n,
    }));

    expect(harness.simulate).toHaveBeenCalledOnce();
    expect(harness.build).toHaveBeenCalledOnce();
    expect(BigInt(result.userOperation.paymasterVerificationGasLimit!)).toBe(450_000n);
    expect(BigInt(result.userOperation.paymasterPostOpGasLimit!)).toBe(50_000n);
  });

  it('rejects invalid estimates and stops after bounded non-convergence', async () => {
    await expect(run(baseline, builder(), async () => ({ ...baseline, preVerificationGas: 0n }))).rejects.toThrow('invalid gas estimates');
    const harness = builder();
    const estimate = vi.fn(async (op: SerializedUserOperation) => ({ ...baseline, preVerificationGas: BigInt(op.preVerificationGas) * 2n }));

    await expect(run(baseline, harness, estimate)).rejects.toThrow('did not stabilize after 3 attempts');
    expect(harness.simulate).toHaveBeenCalledTimes(3);
    expect(harness.build).not.toHaveBeenCalled();
    expect(estimate).toHaveBeenCalledTimes(3);
  });
});

describe('buildSignedTornadoUserOp EntryPoint', () => {
  it('signs for the configured EntryPoint', async () => {
    const signer = privateKeyToAccount(`0x${'07'.repeat(32)}`);
    const entryPointAddress = `0x${'43'.repeat(20)}` as const;
    const userOperation = await buildSignedTornadoUserOp({
      signer, chainId: 11155111, entryPointAddress, paymasterAddress: `0x${'11'.repeat(20)}`, paymasterData: '0x',
      gas: reasonableGasUnits(false), maxFeePerGas: 2n, maxPriorityFeePerGas: 1n,
    });
    const signedFor = (verifyingContract: `0x${string}`) => recoverTypedDataAddress({
      ...getUserOperationTypedData({ chainId: 11155111, entryPointAddress: verifyingContract, userOperation: rawOperation(userOperation) }),
      signature: userOperation.signature,
    });

    expect(await signedFor(entryPointAddress)).toBe(signer.address);
    expect(await signedFor(entryPoint08Address)).not.toBe(signer.address);
  });
});
