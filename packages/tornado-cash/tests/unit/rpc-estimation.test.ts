import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Abi, entryPoint08Address, toPackedUserOperation } from 'viem/account-abstraction';
import { buildSignedTornadoUserOp, SIMPLE_7702_IMPLEMENTATION } from '../../src/paymaster/utils';
import { reasonableGasUnits } from '../../src/paymaster/fee';
import { estimateValidationOnlyGas, validateValidationOnlyOperation } from '../../src/paymaster/rpc-estimation';
import { tornadoFallbackGas } from '../../src/paymaster/fallback';
import { parseAbi } from 'viem';

const chainId = 11155111;
const signer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const paymaster = '0x0000000000000000000000000000000000000002';
const gas = { ...reasonableGasUnits(false), callGasLimit: 0n };
const accountAbi = parseAbi(['function validateUserOp((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256 validationData)']);
const paymasterAbi = parseAbi(['function validatePaymasterUserOp((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 maxCost) returns (bytes context, uint256 validationData)']);

async function fixture(nonce = 0) {
  const op = await buildSignedTornadoUserOp({ signer, chainId, paymasterAddress: paymaster, paymasterData: '0x1234', gas,
    maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, authorizationNonce: BigInt(nonce) });
  const request = vi.fn(async ({ method, params }: { method: string; params: unknown[] }): Promise<unknown> => {
    if (method === 'eth_getTransactionCount') return toHex(nonce);

    if (method === 'eth_getCode') return params[0] === SIMPLE_7702_IMPLEMENTATION ? '0x6000' : '0x';

    const tx = params[0] as { to: string };

    if (method === 'eth_call') return tx.to === signer.address
      ? encodeFunctionResult({ abi: accountAbi, functionName: 'validateUserOp', result: 0n })
      : encodeFunctionResult({ abi: paymasterAbi, functionName: 'validatePaymasterUserOp', result: ['0x1234', 0n] });

    if (method === 'eth_estimateGas') return toHex(tx.to === entryPoint08Address ? 400_000n : tx.to === signer.address ? 60_000n : 500_000n);

    throw new Error(`Unexpected ${method}`);
  });

  return { op, provider: { request }, request };
}

describe('host RPC estimation for direct single-note withdrawals', () => {
  it('estimates real account/paymaster calls at zero execution gas with only the pending authorization overridden', async () => {
    const f = await fixture(7);
    const result = await estimateValidationOnlyGas(f.provider, f.op, entryPoint08Address, chainId);

    expect(result).toEqual({ callGasLimit: 0n, verificationGasLimit: 60_000n, paymasterVerificationGasLimit: 500_000n,
      preVerificationGas: tornadoFallbackGas({ ...gas, preVerificationGas: 0n }, f.op).preVerificationGas, paymasterPostOpGasLimit: gas.paymasterPostOpGasLimit });
    const requests = f.request.mock.calls.map(([request]) => request).filter(r => r.method === 'eth_call' || r.method === 'eth_estimateGas');

    expect(requests).toHaveLength(4);

    for (const r of requests) {
      const [tx, block, overrides] = r.params as [{ from: string; to: string; data: `0x${string}` }, string, unknown];

      expect(tx.from).toBe(entryPoint08Address);
      expect(block).toBe('latest');
      expect(overrides).toEqual({ [signer.address]: { code: `0xef0100${SIMPLE_7702_IMPLEMENTATION.slice(2)}`, nonce: '0x8' } });
      const call = decodeFunctionData({ abi: tx.to === signer.address ? accountAbi : paymasterAbi, data: tx.data });
      const packed = call.args![0] as { sender: string; accountGasLimits: `0x${string}`; callData: string; paymasterAndData: string; signature: string };

      expect(packed.sender).toBe(signer.address);
      expect(BigInt(packed.accountGasLimits) & ((1n << 128n) - 1n)).toBe(0n);
      expect(packed.callData).toBe('0x');
      expect(packed.signature).toBe(f.op.signature);
      expect(packed.paymasterAndData.endsWith('1234')).toBe(true);

      if (tx.to === paymaster) expect(call.args![2]).toBe(1_300_000n);
    }
    expect(f.request.mock.calls.some(([r]) => /send|sign|estimateUserOperation/.test(r.method))).toBe(false);
  });

  it('simulates the exact final signed operation through unchanged EntryPoint.handleOps', async () => {
    const f = await fixture();

    await validateValidationOnlyOperation(f.provider, f.op, entryPoint08Address, chainId);
    const request = f.request.mock.calls.find(([r]) => r.method === 'eth_estimateGas')![0];
    const [tx, , overrides] = request.params as [{ to: string; data: `0x${string}`; gasPrice: string }, string, unknown];

    expect(tx.to).toBe(entryPoint08Address); expect(tx.gasPrice).toBe('0x0');
    expect(Object.keys(overrides as object)).toEqual([signer.address]);
    const { args } = decodeFunctionData({ abi: entryPoint08Abi, data: tx.data });
    const packed = (args![0] as ReturnType<typeof toPackedUserOperation>[])[0]!;

    expect(packed.signature).toBe(f.op.signature);
    expect(packed.callData).toBe('0x');
    expect(BigInt(packed.accountGasLimits)).toBe(gas.verificationGasLimit << 128n);
  });

  it.each(['execution', 'calldata', 'chain', 'entrypoint', 'authorization', 'sender'] as const)('rejects an invalid %s without making simulation calls', async reason => {
    const f = await fixture();

    if (reason === 'execution') f.op.callGasLimit = '0x1';

    if (reason === 'calldata') f.op.callData = '0x1234';

    if (reason === 'chain') f.op.eip7702Auth!.chainId = '0x1';

    if (reason === 'authorization') delete f.op.eip7702Auth;

    if (reason === 'sender') f.op.sender = paymaster;

    await expect(estimateValidationOnlyGas(f.provider, f.op, reason === 'entrypoint' ? paymaster : entryPoint08Address, chainId)).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['nonce', 'contract', 'implementation'] as const)('rejects a stale or unavailable %s', async reason => {
    const f = await fixture();

    f.request.mockImplementation(async ({ method, params }) => method === 'eth_getTransactionCount' ? reason === 'nonce' ? '0x1' : '0x0'
      : params[0] === signer.address ? reason === 'contract' ? '0x6000' : '0x' : reason === 'implementation' ? '0x' : '0x6000');
    await expect(estimateValidationOnlyGas(f.provider, f.op, entryPoint08Address, chainId)).rejects.toThrow();
    expect(f.request.mock.calls.some(([r]) => r.method === 'eth_estimateGas')).toBe(false);
  });

  it.each(['account', 'paymaster'] as const)('rejects invalid %s validation return data', async reason => {
    const f = await fixture();
    const normal = f.request.getMockImplementation()!;

    f.request.mockImplementation(async r => {
      if (r.method === 'eth_call' && ((r.params[0] as { to: string }).to === signer.address) === (reason === 'account')) {
        return reason === 'account' ? encodeFunctionResult({ abi: accountAbi, functionName: 'validateUserOp', result: 1n })
          : encodeFunctionResult({ abi: paymasterAbi, functionName: 'validatePaymasterUserOp', result: ['0x', 1n] });
      }

      return normal(r);
    });
    await expect(estimateValidationOnlyGas(f.provider, f.op, entryPoint08Address, chainId)).rejects.toThrow('rejected the withdrawal signature or paymaster');
  });

  it.each(['0x0', '-1', undefined])('rejects malformed/zero gas estimates (%s)', async value => {
    const f = await fixture(), normal = f.request.getMockImplementation()!;

    f.request.mockImplementation(r => r.method === 'eth_estimateGas' ? Promise.resolve(value) : normal(r));
    await expect(estimateValidationOnlyGas(f.provider, f.op, entryPoint08Address, chainId)).rejects.toThrow('invalid withdrawal gas estimate');
  });

  it('fails closed on unsupported RPC state overrides and on final simulation failure', async () => {
    const f = await fixture(), normal = f.request.getMockImplementation()!;

    f.request.mockImplementation(r => r.method === 'eth_call' || r.method === 'eth_estimateGas' ? Promise.reject(new Error('state overrides unsupported')) : normal(r));
    await expect(estimateValidationOnlyGas(f.provider, f.op, entryPoint08Address, chainId)).rejects.toThrow('state overrides unsupported');
    await expect(validateValidationOnlyOperation(f.provider, f.op, entryPoint08Address, chainId)).rejects.toThrow('state overrides unsupported');
    await expect(estimateValidationOnlyGas(undefined, f.op, entryPoint08Address, chainId)).rejects.toThrow('require a host RPC');
  });

  it('rejects a final simulation above the allocated gas', async () => {
    const f = await fixture(), normal = f.request.getMockImplementation()!;

    f.request.mockImplementation(r => r.method === 'eth_estimateGas' ? Promise.resolve('0xffffff') : normal(r));
    await expect(validateValidationOnlyOperation(f.provider, f.op, entryPoint08Address, chainId)).rejects.toThrow('exceeded the allocated gas');
  });
});
