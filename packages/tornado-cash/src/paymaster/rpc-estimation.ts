import type { EthereumProvider } from '@kohaku-eth/provider';
import { concat, decodeFunctionResult, encodeFunctionData, parseAbi, toHex, type Hex } from 'viem';
import { entryPoint08Abi, entryPoint08Address, getUserOperationHash, toPackedUserOperation } from 'viem/account-abstraction';
import { recoverAuthorizationAddress } from 'viem/utils';
import type { SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';
import { tornadoFallbackGas } from './fallback';
import { isRpcSimulationUnsupported, RpcSimulationUnsupportedError } from './estimation-retry';
import { reasonableGasUnits } from './fee';
import { SIMPLE_7702_IMPLEMENTATION } from './utils';

const accountAbi = parseAbi([
  'function validateUserOp((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256 validationData)',
]);
const paymasterAbi = parseAbi([
  'function validatePaymasterUserOp((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 maxCost) returns (bytes context, uint256 validationData)',
]);
const BENEFICIARY = '0x000000000000000000000000000000000000dEaD';

type RpcProvider = Pick<EthereumProvider, 'request'>;

/** Missing override support is an availability failure, not a failed proof.
 * Keep this classification scoped to simulation calls; preserve real reverts. */
async function requestSimulation(provider: RpcProvider, request: Parameters<RpcProvider['request']>[0]) {
  try {
    return await provider.request(request);
  } catch (cause) {
    if (isRpcSimulationUnsupported(cause)) throw new RpcSimulationUnsupportedError(cause);

    throw cause;
  }
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value) || BigInt(value) <= 0n) {
    throw new Error('Host RPC returned an invalid withdrawal gas estimate.');
  }

  return BigInt(value);
}

function unpack(op: SerializedUserOperation) {
  return {
    ...op, nonce: BigInt(op.nonce), callGasLimit: BigInt(op.callGasLimit),
    verificationGasLimit: BigInt(op.verificationGasLimit), preVerificationGas: BigInt(op.preVerificationGas),
    maxFeePerGas: BigInt(op.maxFeePerGas), maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
    paymasterVerificationGasLimit: BigInt(op.paymasterVerificationGasLimit ?? '0x0'),
    paymasterPostOpGasLimit: BigInt(op.paymasterPostOpGasLimit ?? '0x0'),
  };
}

/** Simulate only the pending 7702 authorization; never override protocol code,
 * balances, proof state or EntryPoint storage. Reject stale/invalid authorizations
 * before applying the same delegation the bundler will include on chain. */
async function simulation(provider: RpcProvider | undefined, op: SerializedUserOperation, entryPoint: Hex, chainId: number) {
  if (!provider) throw new Error('Direct Tornado withdrawals require a host RPC with state-override support.');

  if (entryPoint.toLowerCase() !== entryPoint08Address.toLowerCase() || op.callData !== '0x' || BigInt(op.callGasLimit) !== 0n || !op.paymaster) {
    throw new Error('RPC withdrawal estimation requires EntryPoint v0.8 and zero execution gas/calldata.');
  }

  const auth = op.eip7702Auth;

  if (!auth || BigInt(auth.chainId) !== BigInt(chainId) || auth.address.toLowerCase() !== SIMPLE_7702_IMPLEMENTATION.toLowerCase()) {
    throw new Error('Unexpected withdrawal executor authorization.');
  }

  const authorization = { ...auth, chainId: Number(BigInt(auth.chainId)), nonce: Number(BigInt(auth.nonce)), yParity: Number(BigInt(auth.yParity)) as 0 | 1 };

  if ((await recoverAuthorizationAddress({ authorization })).toLowerCase() !== op.sender.toLowerCase()) {
    throw new Error('Withdrawal executor authorization does not match the sender.');
  }

  const [nonce, code, implementation] = await Promise.all([
    provider.request({ method: 'eth_getTransactionCount', params: [op.sender, 'latest'] }),
    provider.request({ method: 'eth_getCode', params: [op.sender, 'latest'] }),
    provider.request({ method: 'eth_getCode', params: [auth.address, 'latest'] }),
  ]);

  if (typeof nonce !== 'string' || BigInt(nonce) !== BigInt(auth.nonce)) throw new Error('Withdrawal executor authorization nonce changed. Prepare a new withdrawal.');

  if (typeof code !== 'string' || (code !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(code))) throw new Error('The withdrawal executor must be an EOA.');

  if (typeof implementation !== 'string' || !/^0x[0-9a-f]+$/i.test(implementation)) throw new Error('The withdrawal executor implementation is unavailable on this chain.');

  const raw = unpack(op);
  const packed = toPackedUserOperation(raw);
  const hash = getUserOperationHash({ userOperation: raw, entryPointAddress: entryPoint08Address, entryPointVersion: '0.8', chainId });
  const overrides = { [op.sender]: { code: concat(['0xef0100', auth.address]), nonce: toHex(BigInt(auth.nonce) + 1n) } };

  return { provider, raw, packed, hash, overrides };
}

/** Estimate account/paymaster validation separately with the REAL packed op,
 * retaining callGasLimit=0 throughout. eth_estimateGas includes transaction
 * intrinsic/calldata gas, so these are conservative per-phase budgets. PVG is a
 * conservative allowance (including 7702), not a bundler-provided quote. */
export async function estimateValidationOnlyGas(
  provider: RpcProvider | undefined, op: SerializedUserOperation, entryPoint: Hex, chainId: number,
): Promise<UserOpGasLimits> {
  const s = await simulation(provider, op, entryPoint, chainId);
  const maxCost = (s.raw.verificationGasLimit + s.raw.preVerificationGas + s.raw.paymasterVerificationGasLimit + s.raw.paymasterPostOpGasLimit) * s.raw.maxFeePerGas;
  const calls = [
    { to: op.sender, data: encodeFunctionData({ abi: accountAbi, functionName: 'validateUserOp', args: [s.packed, s.hash, 0n] }) },
    { to: op.paymaster!, data: encodeFunctionData({ abi: paymasterAbi, functionName: 'validatePaymasterUserOp', args: [s.packed, s.hash, maxCost] }) },
  ];
  const estimates: bigint[] = [];

  for (const [index, call] of calls.entries()) {
    // Validate return data too: a successful eth_estimateGas alone does not mean
    // the account signature (or paymaster time range) was accepted.
    const result = await requestSimulation(s.provider, { method: 'eth_call', params: [{ from: entryPoint, ...call }, 'latest', s.overrides] });
    const validation = index === 0
      ? decodeFunctionResult({ abi: accountAbi, functionName: 'validateUserOp', data: result as Hex })
      : decodeFunctionResult({ abi: paymasterAbi, functionName: 'validatePaymasterUserOp', data: result as Hex })[1];

    if (validation !== 0n) throw new Error('Host RPC rejected the withdrawal signature or paymaster validation.');

    estimates.push(quantity(await requestSimulation(s.provider, { method: 'eth_estimateGas', params: [{ from: entryPoint, ...call }, 'latest', s.overrides] })));
  }

  return {
    callGasLimit: 0n, verificationGasLimit: estimates[0]!, paymasterVerificationGasLimit: estimates[1]!,
    preVerificationGas: tornadoFallbackGas({ ...s.raw, preVerificationGas: 0n }, op).preVerificationGas,
    paymasterPostOpGasLimit: reasonableGasUnits(false).paymasterPostOpGasLimit,
  };
}

/** Check the exact final signature, proof-bound fee, nonce and all allocated gas
 * limits together. No simulation-only fee bypass or altered paymaster code. No
 * transaction is sent; bundler admission and inclusion remain separate. A caller
 * using best-effort may return marked fallback on availability failures only. */
export async function validateValidationOnlyOperation(
  provider: RpcProvider | undefined, op: SerializedUserOperation, entryPoint: Hex, chainId: number,
): Promise<void> {
  const s = await simulation(provider, op, entryPoint, chainId);
  const limit = s.raw.verificationGasLimit + s.raw.paymasterVerificationGasLimit + s.raw.paymasterPostOpGasLimit + s.raw.preVerificationGas + 100_000n;
  const data = encodeFunctionData({ abi: entryPoint08Abi, functionName: 'handleOps', args: [[s.packed], BENEFICIARY] });
  const estimated = quantity(await requestSimulation(s.provider, {
    method: 'eth_estimateGas', params: [{ from: BENEFICIARY, to: entryPoint, data, gas: toHex(limit), gasPrice: '0x0' }, 'latest', s.overrides],
  }));

  if (estimated > limit) throw new Error('Host RPC withdrawal simulation exceeded the allocated gas.');
}
