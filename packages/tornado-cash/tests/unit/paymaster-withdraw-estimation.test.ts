import { unwrapResult } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { RpcRequestError, toHex, decodeFunctionData, decodeAbiParameters, hashTypedData, parseAbiParameters, recoverTypedDataAddress } from 'viem';
import type { SerializedUserOperation } from '../../src/interfaces/user-ops.interface';
import { reasonableGasUnitsForBatch } from '../../src/paymaster/fee';
import { storeFactory } from '../../src/state/store';
import { paymasterWithdrawThunk } from '../../src/state/thunks/paymasterWithdrawThunk';
import type { DelegationConfig, DelegatorAccount } from '../../src/account/delegation.interface';
import { DUMMY_SIGNATURE, verifierForwarder } from '../../src/paymaster/simulation';

/** The bundler's answer when the execution phase runs out of gas (ERC-7769 `-32521`). */
const executionOutOfGas = () => new RpcRequestError({ url: 'unused', body: {}, error: { code: -32521, message: 'Execution out of gas' } });

const fixture = vi.hoisted(() => ({
  isERC20: false,
  chainId: 11155111n,
  kind: 'signature' as 'signature' | 'legacy',
  count: 1,
  pools: [1n] as bigint[],
  verifierTargets: [] as string[],
  deployed: false,
  denomination: 10n ** 18n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
  fees: [] as bigint[],
  proofRecipients: [] as bigint[],
  simulatedFees: [] as bigint[],
  overrides: [] as unknown[],
  quote: vi.fn(async (_paymaster: bigint, _asset: bigint, fee: bigint) => fee * 7n),
  estimate: vi.fn(),
  deriveLegacy: vi.fn(async () => `0x${'03'.repeat(32)}` as const),
  deriveSignature: vi.fn(async () => `0x${'01'.repeat(32)}` as const),
  deriveDelegator: vi.fn(async () => `0x${'02'.repeat(32)}` as const),
  getAccountNonce: vi.fn(async () => 7),
}));

vi.mock('../../src/state/selectors/slices.selectors', () => ({
  instanceRegistryInfoSelector: () => ({ chainId: fixture.chainId }),
  poolsSelector: () => new Map(fixture.pools.map(pool => [pool, { denomination: fixture.denomination, isERC20: fixture.isERC20, asset: fixture.isERC20 ? 2n : 0n }] as const)),
}));
vi.mock('../../src/state/selectors/withdrawals.selector', () => ({
  getWithdrawableDepositsSelector: () => Array.from({ length: fixture.count }, (_, index) => ({ pool: fixture.pools[index % fixture.pools.length]!, kind: fixture.kind, nonce: 0n, nullifier: 7n })),
}));
vi.mock('../../src/state/thunks/verifyRootsThunk', () => ({
  verifyRootsThunk: () => async () => ({ payload: undefined }),
}));
vi.mock('../../src/state/thunks/withdrawalsProofThunk', () => ({
  // Real proofs record `fees`; estimation stand-ins record `simulatedFees`.
  withdrawalsProofThunk: (params: { fee: bigint; recipient: bigint; relayerAddress: bigint; simulation?: boolean }) => async () => {
    fixture.proofRecipients.push(params.recipient);

    if (params.simulation) fixture.simulatedFees.push(params.fee);
    else fixture.fees.push(params.fee);

    return { payload: { proof: params.simulation ? '0xdead' : '0x1234', args: [toHex(1n, { size: 32 }), toHex(params.simulation ? 9n : 2n, { size: 32 }), toHex(params.recipient, { size: 20 }), toHex(params.relayerAddress, { size: 20 }), toHex(params.fee), '0x00'] } };
  },
}));
vi.mock('../../src/paymaster/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/paymaster/utils')>(),
  createPaymasterBundlerClient: () => ({}),
  getUserOperationGasPrice: async () => ({ standard: { maxFeePerGas: fixture.maxFeePerGas, maxPriorityFeePerGas: fixture.maxPriorityFeePerGas } }),
  estimateUserOperationGas: (_client: unknown, op: SerializedUserOperation, _entryPoint: unknown, overrides: unknown) => {
    fixture.overrides.push(overrides);

    return fixture.estimate(op);
  },
}));

const VERIFIER = '0x00000000000000000000000000000000000000ce';
const VERIFIER_CODE = '0x60006000fd';
const verifierCall = (params: unknown) => (params as [{ data?: string }])[0]?.data === '0x2b7ac3f3';

/** The bundler saw a non-executable stand-in for `op`: same gas and sender, dummy proof and signature. */
function expectSimulatedLast(op: SerializedUserOperation) {
  const simulated = fixture.estimate.mock.calls.at(-1)![0] as SerializedUserOperation;
  const fields = ['sender', 'nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit', 'maxFeePerGas'] as const;

  for (const field of fields) expect(simulated[field]).toBe(op[field]);

  expect(simulated.signature).toBe(DUMMY_SIGNATURE);
  expect(simulated.paymasterData).not.toBe(op.paymasterData);
}

async function prepare(delegation: DelegationConfig | null = null, overrides: Record<string, unknown> = {}) {
  const store = storeFactory({ logLevel: 'off' });

  return unwrapResult(await store.dispatch(paymasterWithdrawThunk({
    dataService: { getChainId: async () => fixture.chainId, quoteWeiInToken: fixture.quote, getAccountNonce: fixture.getAccountNonce },
    provider: { request: async ({ method, params }: { method: string; params: [{ to?: string; data?: string } | string] }) => {
      if (method === 'eth_getCode' && params[0] === VERIFIER) return VERIFIER_CODE;

      if (method === 'eth_getCode') return delegation?.mode === 'smart-account' && (fixture.deployed || !delegation.account.factory) ? '0x6000' : '0x';

      if (method === 'eth_getBalance' || method === 'eth_getTransactionCount') return '0x0';

      if (method === 'eth_call' && verifierCall(params)) {
        const target = (params[0] as { to: string }).to;

        if (!/^0x[0-9a-fA-F]{40}$/.test(target)) throw new Error('Invalid verifier lookup address');

        fixture.verifierTargets.push(target);

        return toHex(BigInt(VERIFIER), { size: 32 });
      }

      if (method === 'eth_call') return toHex(delegation?.nonce ?? 0n, { size: 32 });

      if (method === 'eth_getBlockByNumber') return { baseFeePerGas: toHex(1_000_000_000_000n) };

      if (method === 'eth_maxPriorityFeePerGas') return toHex(1n);

      throw new Error(`Unexpected host RPC method: ${method}`);
    } },
    assetAddress: fixture.isERC20 ? 2n : 0n,
    amount: BigInt(fixture.count) * 10n ** 18n,
    recipient: 3n,
    secretManager: { deriveLegacyEphemeralSigner: fixture.deriveLegacy, deriveSignatureEphemeralSigner: fixture.deriveSignature, deriveDelegatorSigner: fixture.deriveDelegator },
    paymasterSettings: { [Number(fixture.chainId)]: {
      paymasterAddress: '0x0000000000000000000000000000000000000004',
      entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108', bundlerUrl: 'unused',
      supportedPools: fixture.pools.map(pool => toHex(pool, { size: 20 })),
    }, ...(delegation ? { delegation } : {}) },
    proverFactory: async () => ({}),
    ...overrides,
  } as never)));
}

  beforeEach(() => {
    fixture.maxFeePerGas = 2n;
    fixture.maxPriorityFeePerGas = 1n;
    fixture.denomination = 10n ** 18n;
    fixture.count = 2;
    fixture.pools = [1n];
    fixture.verifierTargets = [];
    fixture.deployed = false;
    fixture.isERC20 = false;
    fixture.chainId = 11155111n;
    fixture.kind = 'signature';
    fixture.deriveLegacy.mockClear();
    fixture.fees = [];
    fixture.proofRecipients = [];
    fixture.simulatedFees = [];
    fixture.overrides = [];
    fixture.quote.mockClear();
    fixture.estimate.mockReset();
    fixture.deriveSignature.mockClear();
    fixture.deriveDelegator.mockClear();
    fixture.getAccountNonce.mockReset().mockResolvedValue(7);
  });

describe('paymaster withdrawal preparation integration', () => {
  const leadingZeroPool = 0x0E999C5285141ccB6dFaE68A0921F37ABd3e6A87n;
  const classicPool = 0x8C4A04d872a6C1BE37964A21ba3a138525dFF50bn;

  it.each([
    { scenario: 'a single note', pools: [leadingZeroPool] },
    { scenario: 'the first pool in a batch', pools: [leadingZeroPool, classicPool] },
    { scenario: 'the second pool in a batch', pools: [classicPool, leadingZeroPool] },
  ])('keeps verifier lookup addresses padded for $scenario', async ({ pools }) => {
    fixture.pools = pools;
    fixture.count = pools.length;
    fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(false, pools.length - 1, false));
    const [withdrawal] = await prepare();

    expect(withdrawal?.mode).toBe('paymaster');
    expect(fixture.verifierTargets).toEqual(pools.map(pool => toHex(pool, { size: 20 })));
    expect(fixture.estimate).toHaveBeenCalled();
  });

  const incompatibleEstimator = () => new RpcRequestError({
    url: 'https://bundler.invalid', body: {}, error: {
      code: -32501,
      message: 'AA33 reverted 0x54107e370000000000000000000000000000000000000000000000000000000000989680',
    },
  });

  it.each(['random', 'deterministic', 'external'] as const)('keeps direct payout when bundler estimation is incompatible for a %s sender', async mode => {
    fixture.count = 1;
    fixture.isERC20 = true;
    fixture.getAccountNonce.mockResolvedValue(mode === 'external' ? 5 : 0);
    const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
    const delegation: DelegationConfig = mode === 'external' ? { mode, signer: account as DelegatorAccount } : { mode };

    fixture.estimate.mockRejectedValue(incompatibleEstimator());
    const [withdrawal] = await prepare(delegation);

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(withdrawal!.gasEstimation).toMatchObject({ status: 'fallback', reason: 'bundler-internal' });
    expect(BigInt(withdrawal!.userOperation.verificationGasLimit)).toBe(150_000n);
    expect(BigInt(withdrawal!.userOperation.preVerificationGas)).toBe(300_000n);
    expect(BigInt(withdrawal!.userOperation.paymasterVerificationGasLimit!)).toBe(1_200_000n);
    expect(withdrawal!.userOperation.callData).toBe('0x');
    expect(withdrawal!.userOperation.callGasLimit).toBe('0x0');
    expect(BigInt(withdrawal!.proof.args[2])).toBe(3n);
    expect(BigInt(withdrawal!.proof.args[4])).toBe(fixture.fees.at(-1));
    expect(fixture.fees).toHaveLength(1);
    expect(fixture.simulatedFees).toHaveLength(1);
    expect(fixture.fees[0]).toBeGreaterThan(fixture.simulatedFees[0]!);
    expect(fixture.quote).toHaveBeenCalledTimes(2);
    expect(fixture.estimate).toHaveBeenCalledTimes(1);
    expect(fixture.estimate.mock.calls[0]![0].callGasLimit).toBe('0x0');
  });

  it('estimates with dummy proofs and signatures under verifier overrides, then proves and signs once', async () => {
    fixture.count = 2;
    const signer = privateKeyToAccount(`0x${'09'.repeat(32)}`);
    const signTypedData = vi.fn(signer.signTypedData), signAuthorization = vi.fn(signer.signAuthorization);

    fixture.estimate.mockResolvedValueOnce({ ...reasonableGasUnitsForBatch(false, 1, false), preVerificationGas: 281_260n })
      .mockResolvedValue(reasonableGasUnitsForBatch(false, 1, false));
    const [withdrawal] = await prepare({ mode: 'external', allowUsed: true, signer: { ...signer, signTypedData, signAuthorization } as DelegatorAccount });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(fixture.estimate).toHaveBeenCalledTimes(2);

    for (const [op] of fixture.estimate.mock.calls as [SerializedUserOperation][]) {
      expect(op.signature).toBe(DUMMY_SIGNATURE);
      expect(op.eip7702Auth!.r).not.toBe(withdrawal!.userOperation.eip7702Auth!.r);
      // Real proofs (0x1234) never leave: neither sponsoring nor batched direct withdrawals.
      expect(op.paymasterData).toContain('dead');
      expect(op.paymasterData).not.toContain('1234');
      expect(op.callData).toContain('dead');
      expect(op.callData).not.toContain('1234');
    }

    for (const overrides of fixture.overrides) {
      const shadow = Object.keys(overrides as object).find(address => address !== VERIFIER)!;

      expect(overrides).toEqual({ [shadow]: { code: VERIFIER_CODE }, [VERIFIER]: { code: verifierForwarder(shadow as `0x${string}`) } });
    }

    expect(signAuthorization).toHaveBeenCalledOnce();
    expect(signTypedData).toHaveBeenCalledOnce();
    expect(withdrawal!.userOperation.paymasterData).toContain('1234');
    expect(withdrawal!.userOperation.callData).toContain('1234');
  });

  it('allows marked direct fallback after a transport outage on mainnet', async () => {
    fixture.count = 1;
    fixture.chainId = 1n;
    fixture.estimate.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
    const [withdrawal] = await prepare();

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(withdrawal!.gasEstimation).toMatchObject({ status: 'fallback', reason: 'transport-unavailable' });
    expect(BigInt(withdrawal!.userOperation.verificationGasLimit)).toBe(150_000n);
    expect(BigInt(withdrawal!.userOperation.preVerificationGas)).toBe(300_000n);
    expect(BigInt(withdrawal!.userOperation.paymasterVerificationGasLimit!)).toBe(650_000n);
    expect(withdrawal!.userOperation.callGasLimit).toBe('0x0');
    expect(BigInt(withdrawal!.proof.args[2])).toBe(3n);
  });

  it('requires successful bundler estimation under required policy', async () => {
    fixture.count = 1;
    fixture.estimate.mockRejectedValue(incompatibleEstimator());
    await expect(prepare(null, { gasEstimationPolicy: 'required' })).rejects.toThrow('preparation stopped');
    expect(fixture.estimate).toHaveBeenCalledTimes(1);
  });

  it('does not use direct fallback on an unknown chain', async () => {
    fixture.count = 1;
    fixture.chainId = 31337n;
    fixture.estimate.mockRejectedValue(incompatibleEstimator());
    await expect(prepare()).rejects.toThrow('preparation stopped');
  });

  it('rejects a direct fallback fee that would consume the note', async () => {
    fixture.count = 1;
    fixture.maxFeePerGas = 1_100_000_000_000n;
    fixture.estimate.mockRejectedValue(incompatibleEstimator());
    await expect(prepare()).rejects.toThrow('fee would consume the sponsoring note');
    expect(fixture.simulatedFees).toHaveLength(1);
    expect(fixture.fees).toHaveLength(0);
  });

  it.each([
    { code: -32500, message: 'AA33 invalid proof' },
    { code: -32500, message: 'AA24 signature error' },
    { code: -32602, message: 'Invalid params' },
    { code: -32603, message: 'Internal error' },
  ])('rejects genuine or unclassified direct estimation failures: $message', async error => {
    fixture.count = 1;
    fixture.estimate.mockRejectedValue(new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error }));
    await expect(prepare()).rejects.toThrow('preparation stopped');
  });



  it.each([
    { count: 1, isERC20: false }, { count: 2, isERC20: false },
    { count: 1, isERC20: true }, { count: 2, isERC20: true },
  ])('rebuilds and validates the final payload for $count note(s), ERC20=$isERC20', async ({ count, isERC20 }) => {
    fixture.count = count;
    fixture.isERC20 = isERC20;
    const gas = reasonableGasUnitsForBatch(isERC20, count - 1, false);

    const estimate = fixture.estimate;

    estimate.mockImplementation(async (op: SerializedUserOperation) => {
      // The bundler searches execution gas with a 10M ceiling. The paymaster
      // rejects that ceiling if the sponsoring recipient differs from sender.
      const proofRecipient = fixture.proofRecipients.at(-1)!;

      if (proofRecipient !== (count === 1 ? 3n : BigInt(op.sender))) {
        throw new Error('AA33 reverted 0x54107e370000000000000000000000000000000000000000000000000000000000989680');
      }

      return { ...gas, preVerificationGas: 281_260n };
    });
    const withdrawals = await prepare();
    const withdrawal = withdrawals[0]!;

    expect(withdrawal.mode).toBe('paymaster');

    if (withdrawal.mode !== 'paymaster') throw new Error('Expected paymaster payload');

    expect(estimate).toHaveBeenCalledTimes(2);
    expectSimulatedLast(withdrawal.userOperation);
    expect(BigInt(withdrawal.userOperation.preVerificationGas)).toBe(337_512n);
    const simulatedFees = fixture.simulatedFees.filter((fee) => fee > 0n);

    expect(simulatedFees).toHaveLength(2);
    expect(simulatedFees[1]).toBeGreaterThan(simulatedFees[0]!);
    expect(fixture.fees.filter((fee) => fee > 0n)).toEqual([simulatedFees[1]]);
    expect(BigInt(withdrawal.proof.args[4])).toBe(simulatedFees[1]);

    if (count === 1) {
      expect(withdrawal.userOperation.callData).toBe('0x');
      expect(withdrawal.userOperation.callGasLimit).toBe('0x0');
      expect(BigInt(withdrawal.proof.args[2])).toBe(3n);
      expect(withdrawal.gasEstimation).toEqual({ status: 'estimated' });
    } else {
      expect(withdrawal.userOperation.callData).not.toBe('0x');
      expect(BigInt(withdrawal.userOperation.callGasLimit)).toBeGreaterThan(0n);
      expect(BigInt(withdrawal.proof.args[2])).toBe(BigInt(withdrawal.userOperation.sender));
    }

    expect(fixture.quote).toHaveBeenCalledTimes(isERC20 ? 2 : 0);
  });

  it('uses EOA nonce zero for note-derived senders and the current EOA nonce for an explicit wallet path', async () => {
    fixture.count = 2;
    fixture.isERC20 = false;
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, false), preVerificationGas: 281_260n });
    const [noteDerived] = await prepare(null);

    if (noteDerived!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');

    expect(noteDerived!.userOperation.sender).toBe(privateKeyToAccount(`0x${'01'.repeat(32)}`).address);
    expect(noteDerived!.userOperation.nonce).toBe('0x0');
    expect(noteDerived!.userOperation.eip7702Auth?.nonce).toBe('0x0');
    expect(fixture.getAccountNonce).not.toHaveBeenCalled();
    expect(fixture.deriveSignature).toHaveBeenCalledWith({ nonce: 0n, chainId: 11155111n, poolAddress: 1n });
    const path = "m/44'/60'/0'/0/3";
    const [walletDerived] = await prepare({ mode: 'deterministic', path });

    if (walletDerived!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');

    expect(walletDerived!.userOperation.sender).toBe(privateKeyToAccount(`0x${'02'.repeat(32)}`).address);
    expect(walletDerived!.userOperation.nonce).toBe('0x0');
    expect(walletDerived!.userOperation.eip7702Auth?.nonce).toBe('0x7');
    expect(fixture.getAccountNonce).toHaveBeenCalledExactlyOnceWith(BigInt(walletDerived!.userOperation.sender));
    expect(fixture.deriveDelegator).toHaveBeenCalledWith({ path });
  });

  it('keeps a random sender at EOA and EntryPoint nonce zero without querying the account', async () => {
    fixture.count = 1;
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, false), preVerificationGas: 281_260n });
    const [withdrawal] = await prepare({ mode: 'random' });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');

    expect(withdrawal!.userOperation.nonce).toBe('0x0');
    expect(withdrawal!.userOperation.eip7702Auth?.nonce).toBe('0x0');
    expect(fixture.getAccountNonce).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects random execution before proving (multiple notes=%s)', async multipleNotes => {
    fixture.count = multipleNotes ? 2 : 1;
    const tailCalls = multipleNotes ? undefined : vi.fn(async () => []);

    await expect(prepare({ mode: 'random' }, { tailCalls })).rejects.toThrow('allowUnsafeRandomExecution: true');
    expect(fixture.fees).toHaveLength(0);
    expect(fixture.estimate).not.toHaveBeenCalled();

    if (tailCalls) expect(tailCalls).not.toHaveBeenCalled();
  });

  it('allows explicitly opted-in random execution with an empty tail-call callback', async () => {
    fixture.count = 1;
    fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(false, 0, true));
    const tailCalls = vi.fn(async () => []);
    const [withdrawal] = await prepare({ mode: 'random', allowUnsafeRandomExecution: true }, { tailCalls });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');

    expect(tailCalls).toHaveBeenCalledWith(withdrawal!.userOperation.sender);
    expect(fixture.proofRecipients.every(recipient => recipient === BigInt(withdrawal!.userOperation.sender))).toBe(true);
  });

  it('requests external signatures, caches authorization across gas refinements and never derives a key', async () => {
    fixture.count = 2;
    const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
    const signAuthorization = vi.fn(account.signAuthorization);
    const signTypedData = vi.fn(account.signTypedData);
    const signer = { address: account.address, signAuthorization, signTypedData } as DelegatorAccount;

    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 1, false), preVerificationGas: 281_260n });
    const [withdrawal] = await prepare({ mode: 'external', signer });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');

    expect(withdrawal!.userOperation.sender).toBe(account.address);
    expect(withdrawal!.userOperation.nonce).toBe('0x0');
    expect(withdrawal!.userOperation.eip7702Auth?.nonce).toBe('0x7');
    // Only the final operation is signed; estimation never requests a signature.
    expect(signAuthorization).toHaveBeenCalledTimes(1);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expectSimulatedLast(withdrawal!.userOperation);
    expect(fixture.deriveSignature).not.toHaveBeenCalled();
    expect(fixture.deriveLegacy).not.toHaveBeenCalled();
    expect(fixture.deriveDelegator).not.toHaveBeenCalled();
  });

  it.each(['authorization', 'userop', 'rejected'] as const)('stops on a bad external %s signature without fallback signing', async (mode) => {
    const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
    const other = privateKeyToAccount(`0x${'08'.repeat(32)}`);
    const signer: DelegatorAccount = { address: account.address,
      signAuthorization: mode === 'authorization' ? other.signAuthorization : mode === 'rejected' ? async () => { throw new Error('User rejected authorization'); } : account.signAuthorization,
      signTypedData: mode === 'userop' ? other.signTypedData : account.signTypedData };

    fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(false, 1, false));
    await expect(prepare({ mode: 'external', allowUsed: true, signer })).rejects.toThrow(mode === 'rejected' ? 'User rejected' : 'does not match');
    expect(fixture.estimate.mock.calls.every(([op]) => op.signature === DUMMY_SIGNATURE)).toBe(true);
    expect(fixture.deriveSignature).not.toHaveBeenCalled();
    expect(fixture.deriveDelegator).not.toHaveBeenCalled();
  });

  it('requires a successful estimate for external signing rather than requesting a fallback signature', async () => {
    const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
    const signTypedData = vi.fn(account.signTypedData);

    fixture.estimate.mockRejectedValue(new Error('network timeout'));
    await expect(prepare({ mode: 'external', allowUsed: true, signer: { ...account, signTypedData } as DelegatorAccount })).rejects.toThrow('gas estimation failed');
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it('allows explicit best-effort fallback for a recoverable standard withdrawal and exposes metadata', async () => {
    fixture.count = 2;
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } }));
    const [withdrawal] = await prepare(null);

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(withdrawal!.gasEstimation).toMatchObject({ status: 'fallback', reason: 'bundler-internal' });
    expect(BigInt(withdrawal!.userOperation.preVerificationGas)).toBeGreaterThan(350_000n);
    expect(BigInt(withdrawal!.proof.args[4])).toBe(fixture.fees.find(fee => fee > 0n));
  });

  it('supports legacy-note fallback with a recoverable legacy-derived sender', async () => {
    fixture.count = 2;
    fixture.kind = 'legacy';
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } }));
    const [withdrawal] = await prepare(null);

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(withdrawal!.gasEstimation!.status).toBe('fallback');
    expect(withdrawal!.userOperation.sender).toBe(privateKeyToAccount(`0x${'03'.repeat(32)}`).address);
    expect(fixture.deriveLegacy).toHaveBeenCalledWith({ nullifier: 7n });
    expect(BigInt(withdrawal!.proof.args[2])).toBe(BigInt(withdrawal!.userOperation.sender));
  });

  it('does not guess Ethereum fallback budgets for an unknown chain', async () => {
    fixture.count = 2;
    fixture.chainId = 31337n;
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } }));
    await expect(prepare(null)).rejects.toMatchObject({ message: expect.stringContaining('preparation stopped') });
  });

  it('rejects a fallback fee that would consume the sponsoring note before generating another proof', async () => {
    fixture.count = 2;
    fixture.isERC20 = false;
    fixture.maxFeePerGas = 700_000_000_000n;
    fixture.estimate.mockRejectedValue(new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } }));
    await expect(prepare(null)).rejects.toMatchObject({ message: expect.stringContaining('fee would consume the sponsoring note') });
    expect(fixture.simulatedFees.filter(fee => fee > 0n)).toHaveLength(1);
    expect(fixture.fees).toHaveLength(0);
  });

  it('does not fallback on execution paths for strict callers, random senders, or user tail calls', async () => {
    fixture.count = 2;
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new RpcRequestError({ url: 'https://bundler.invalid', body: {}, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } }));
    await expect(prepare(null, { gasEstimationPolicy: 'required' })).rejects.toMatchObject({ message: expect.stringContaining('preparation stopped') });
    await expect(prepare({ mode: 'random', allowUnsafeRandomExecution: true })).rejects.toMatchObject({ message: expect.stringContaining('preparation stopped') });
    await expect(prepare(null, { tailCalls: async () => [], tailCallsGasEstimate: 0n })).rejects.toMatchObject({ message: expect.stringContaining('preparation stopped') });
  });

  it('rejects preparation instead of returning a baseline signed operation', async () => {
    fixture.count = 2;
    fixture.isERC20 = false;
    fixture.estimate.mockRejectedValue(new Error('bundler is offline'));
    await expect(prepare()).rejects.toMatchObject({ message: expect.stringContaining('gas estimation failed: bundler is offline') });
  });
  it('rejects an inflated gas price before deriving a signer or proving', async () => {
    fixture.maxFeePerGas = 10_000_000_000_000n;
    await expect(prepare()).rejects.toMatchObject({ message: expect.stringContaining('host RPC bounds') });
    expect(fixture.fees).toHaveLength(0);
    expect(fixture.deriveSignature).not.toHaveBeenCalled();
  });

  it('accepts a recent tip spike even when the RPC tip suggestion is near zero', async () => {
    fixture.maxFeePerGas = 16_000_000_000n;
    fixture.maxPriorityFeePerGas = 4_000_000_000n;
    fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(false, 0, false));
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => method === 'eth_getCode' ? (params as string[])[0] === VERIFIER ? VERIFIER_CODE : '0x'
      : method === 'eth_call' ? toHex(verifierCall(params) ? BigInt(VERIFIER) : 0n, { size: 32 }) : method === 'eth_getBalance' || method === 'eth_getTransactionCount' ? '0x0' : ({
      baseFeePerGas: Array(11).fill(toHex(10_000_000_000n)),
      reward: [...Array(9).fill([toHex(15_166n)]), [toHex(4_000_000_000n)]],
    }));
    const [withdrawal] = await prepare(null, { provider: { request } });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(request).toHaveBeenCalledWith({ method: 'eth_feeHistory', params: ['0xa', 'latest', [90]] });
    expect(BigInt(withdrawal!.userOperation.maxPriorityFeePerGas)).toBe(fixture.maxPriorityFeePerGas);
    expect(BigInt(withdrawal!.userOperation.maxFeePerGas)).toBe(fixture.maxFeePerGas);
    expectSimulatedLast(withdrawal!.userOperation);
  });

  it('rejects tips over 20 gwei before deriving a signer or proving', async () => {
    fixture.maxFeePerGas = 40_000_000_000n;
    fixture.maxPriorityFeePerGas = 21_000_000_000n;
    const request = async () => ({
      baseFeePerGas: [toHex(10_000_000_000n), toHex(10_000_000_000n)],
      reward: [[toHex(100_000_000_000n)]],
    });

    await expect(prepare(null, { provider: { request } })).rejects.toMatchObject({
      message: expect.stringContaining('requested: maxFeePerGas=40000000000, maxPriorityFeePerGas=21000000000'),
    });
    expect(fixture.fees).toHaveLength(0);
    expect(fixture.deriveSignature).not.toHaveBeenCalled();
    expect(fixture.estimate).not.toHaveBeenCalled();
  });

  it('allows heavy tail calls and large calldata with payload-aware pre-verification bounds', async () => {
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, true), callGasLimit: 3_000_000n, preVerificationGas: 1_000_000n });
    const [withdrawal] = await prepare(null, { tailCalls: async () => [{ to: '0x0000000000000000000000000000000000000003', value: 0n, data: `0x${'11'.repeat(32_768)}` }] });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(BigInt(withdrawal!.userOperation.callGasLimit)).toBe(3_600_000n);
    expect(BigInt(withdrawal!.userOperation.preVerificationGas)).toBe(1_200_000n);
    expectSimulatedLast(withdrawal!.userOperation);
    expect(withdrawal!.fee).toBe(BigInt(withdrawal!.proof.args[4]));
  });

  it('resolves tail calls once, so the signed calls are the estimated ones', async () => {
    fixture.count = 1;
    const targets = ['0x00000000000000000000000000000000000000a1', '0x00000000000000000000000000000000000000a2'] as const;
    const first = { to: targets[0] as string, value: 0n, data: '0xabcdef01' };
    // A callback that would answer differently on every call.
    const tailCalls = vi.fn().mockResolvedValueOnce([first]).mockResolvedValue([{ to: targets[1], value: 0n, data: '0xabcdef01' }]);

    // Mutating the returned call after estimation must not change the signed one either.
    fixture.estimate.mockImplementation(async () => {
      first.to = targets[1];

      return reasonableGasUnitsForBatch(false, 0, true);
    });
    const [withdrawal] = await prepare(null, { tailCalls });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(tailCalls).toHaveBeenCalledOnce();
    expect(tailCalls).toHaveBeenCalledWith(withdrawal!.userOperation.sender);

    for (const [op] of fixture.estimate.mock.calls as [SerializedUserOperation][]) expect(op.callData).toBe(withdrawal!.userOperation.callData);

    expect(withdrawal!.userOperation.callData).toContain(targets[0].slice(2));
  });

  it.each([
    ['a non-array', {}],
    ['an invalid address', [{ to: '0x1234', value: 0n, data: '0x' }]],
    ['a non-bigint value', [{ to: '0x0000000000000000000000000000000000000003', value: 1, data: '0x' }]],
    ['a negative value', [{ to: '0x0000000000000000000000000000000000000003', value: -1n, data: '0x' }]],
    ['odd-length data', [{ to: '0x0000000000000000000000000000000000000003', value: 0n, data: '0x123' }]],
  ])('rejects tail calls resolving to %s before estimating or proving', async (_case, calls) => {
    fixture.count = 1;
    await expect(prepare(null, { tailCalls: async () => calls })).rejects.toThrow('tailCalls must resolve to an array');
    expect(fixture.estimate).not.toHaveBeenCalled();
    expect(fixture.simulatedFees).toHaveLength(0);
    expect(fixture.fees).toHaveLength(0);
  });

  it('allows most of a 0.01 ETH sponsoring note to pay gas', async () => {
    fixture.denomination = 10n ** 16n;
    fixture.maxFeePerGas = 5_000_000_000n;
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, false), preVerificationGas: 281_260n });
    const [withdrawal] = await prepare(null);

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(withdrawal!.fee).toBeGreaterThan(fixture.denomination / 2n);
    expect(withdrawal!.fee).toBeLessThan(fixture.denomination);
  });

  it('enforces explicit execution ceilings without falling back or proving the inflated result', async () => {
    fixture.count = 1;
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, true), callGasLimit: 1_000_000n });
    await expect(prepare(null, { tailCalls: async () => [{ to: '0x0000000000000000000000000000000000000003', value: 0n, data: '0x' }], maxGasLimits: { callGasLimit: 500_000n } })).rejects.toMatchObject({ message: expect.stringContaining('callGasLimit') });
    expect(fixture.simulatedFees.filter(fee => fee > 0n)).toHaveLength(1);
    expect(fixture.fees).toHaveLength(0);
  });

  it('rejects inflated fully charged pre-verification gas before rebuilding', async () => {
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 0, false), preVerificationGas: 10_000_000n });
    await expect(prepare(null)).rejects.toMatchObject({ message: expect.stringContaining('preVerificationGas') });
    expect(fixture.simulatedFees.filter(fee => fee > 0n)).toHaveLength(1);
    expect(fixture.fees).toHaveLength(0);
  });

});

describe('execution account routes', () => {
  const owner = privateKeyToAccount(`0x${'09'.repeat(32)}`);
  const accountAddress = '0x0000000000000000000000000000000000000099';

  it.each([{ deploy: false, factory: false }, { deploy: false, factory: true }, { deploy: true, factory: true }])('collects a multi-note batch in a SimpleAccount (deploy=$deploy, factory=$factory)', async ({ deploy, factory }) => {
    fixture.deployed = !deploy;
    fixture.count = 2;
    const signTypedData = vi.fn(owner.signTypedData);

    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 1, false), preVerificationGas: 281_260n });
    const [withdrawal] = await prepare({ mode: 'smart-account', allowUsed: true, signer: { address: owner.address, signTypedData }, nonce: deploy ? 0n : 3n,
      account: { kind: 'simple-account', address: accountAddress, ...(factory ? { factory: { address: '0x0000000000000000000000000000000000000088' as const, salt: 7n } } : {}) },
    }, { recipient: BigInt(accountAddress) });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    const op = withdrawal!.userOperation;

    expect(op.sender).toBe(accountAddress); expect(op.nonce).toBe(deploy ? '0x0' : '0x3');
    expect(op).not.toHaveProperty('eip7702Auth');
    expect(!!op.factory).toBe(deploy); expect(!!op.factoryData).toBe(deploy);
    expect(BigInt(fixture.estimate.mock.calls[0]![0].verificationGasLimit)).toBe(deploy ? 500_000n : 50_000n);
    const { SIMPLE_7702_EXECUTE_ABI } = await import('../../src/data/abis/account.abi');
    const decoded = decodeFunctionData({ abi: SIMPLE_7702_EXECUTE_ABI, data: op.callData });

    expect(decoded.functionName).toBe('execute'); // only the second withdrawal; no self-forward
    expect(fixture.proofRecipients.every(recipient => recipient === BigInt(accountAddress))).toBe(true);

    for (const [data] of signTypedData.mock.calls) expect(await recoverTypedDataAddress({ ...data, signature: await owner.signTypedData(data) } as never)).toBe(owner.address);
    expect(fixture.getAccountNonce).not.toHaveBeenCalled(); expect(fixture.deriveSignature).not.toHaveBeenCalled();
    // No 7702 authorization carries the chain, so the payload keeps the signed hash for send recovery.
    expect(withdrawal!.userOpHash).toBe(hashTypedData(signTypedData.mock.calls.at(-1)![0] as never));
  });
  const singleNoteAccounts: { name: string; delegation: DelegationConfig | null }[] = [
    { name: 'note-derived', delegation: null },
    { name: 'random 7702', delegation: { mode: 'random' } },
    { name: 'external 7702', delegation: { mode: 'external', signer: owner, allowUsed: true } },
    { name: 'alternate 7702', delegation: { mode: 'external', signer: owner, implementation: accountAddress, allowUsed: true } },
    { name: 'deployed smart account', delegation: { mode: 'smart-account', allowUsed: true, signer: owner, nonce: 3n,
      account: { kind: 'simple-account', address: accountAddress } } },
    { name: 'factory smart account', delegation: { mode: 'smart-account', signer: owner,
      account: { kind: 'simple-account', address: accountAddress, factory: { address: '0x0000000000000000000000000000000000000088', salt: 7n } } } },
  ];

  describe.each([false, true])('single-note direct payouts (ERC20=%s)', isERC20 => {
    it.each(singleNoteAccounts)('pays and refunds the recipient directly for $name', async ({ delegation }) => {
      fixture.count = 1;
      fixture.isERC20 = isERC20;
      fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(isERC20, 0, false), callGasLimit: 9_000n, preVerificationGas: 281_260n });
      const [withdrawal] = await prepare(delegation, { executionGasRetry: true, maxGasLimits: { callGasLimit: 800_000n } });

      if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

      const op = withdrawal!.userOperation;
      const [data] = decodeAbiParameters(parseAbiParameters('(address instance, bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 fee)'), op.paymasterData!);

      // TornadoPaymaster uses this same bound recipient for payout and postOp refund.
      expect(BigInt(data.recipient)).toBe(3n);
      expect(BigInt(op.sender)).not.toBe(3n);
      expect(fixture.proofRecipients.every(recipient => recipient === 3n)).toBe(true);
      expect(op.callData).toBe('0x');
      expect(op.callGasLimit).toBe('0x0');

      for (const [candidate] of fixture.estimate.mock.calls) {
        expect(candidate.callData).toBe('0x');
        expect(candidate.callGasLimit).toBe('0x0');
      }
      expectSimulatedLast(op);
      expect(withdrawal!.gasEstimation!.status).toBe('estimated');
      expect(Boolean(op.factory)).toBe(delegation?.mode === 'smart-account' && Boolean(delegation.account.factory));
      expect(Boolean(op.eip7702Auth)).toBe(delegation?.mode !== 'smart-account');
    });

    it.each(singleNoteAccounts.filter(account => account.name !== 'random 7702'))('funds $name before executing single-note tail calls', async ({ delegation }) => {
      fixture.count = 1;
      fixture.isERC20 = isERC20;
      fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(isERC20, 0, true));
      const tailCalls = vi.fn(async () => [{ to: owner.address, value: 0n, data: '0x1234' as const }]);
      const [withdrawal] = await prepare(delegation, { tailCalls });

      if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

      const op = withdrawal!.userOperation;
      const [data] = decodeAbiParameters(parseAbiParameters('(address instance, bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 fee)'), op.paymasterData!);

      expect(BigInt(data.recipient)).toBe(BigInt(op.sender));
      expect(BigInt(data.recipient)).not.toBe(3n);
      expect(fixture.proofRecipients.every(recipient => recipient === BigInt(op.sender))).toBe(true);
      expect(tailCalls).toHaveBeenCalledWith(op.sender);
      expect(BigInt(op.callGasLimit)).toBeGreaterThan(0n);
      const { SIMPLE_7702_EXECUTE_ABI } = await import('../../src/data/abis/account.abi');
      const decoded = decodeFunctionData({ abi: SIMPLE_7702_EXECUTE_ABI, data: op.callData });

      expect(decoded.functionName).toBe('execute');
      expect(decoded.args).toEqual([owner.address, 0n, '0x1234']);
      expectSimulatedLast(op);
      expect(withdrawal!.gasEstimation!.status).toBe('estimated');
    });
  });

  it.each(['smart-account', 'external'] as const)('pays directly when the requested recipient is the %s sender itself', async mode => {
    fixture.count = 1;
    fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(false, 0, false));
    const signTypedData = vi.fn(owner.signTypedData), signAuthorization = vi.fn(owner.signAuthorization);
    const delegation: DelegationConfig = mode === 'smart-account'
      ? { mode, signer: { address: owner.address, signTypedData }, account: { kind: 'simple-account', address: accountAddress }, allowUsed: true }
      : { mode, signer: { ...owner, signTypedData, signAuthorization }, allowUsed: true };
    const recipient = BigInt(mode === 'smart-account' ? accountAddress : owner.address);
    const [withdrawal] = await prepare(delegation, { recipient });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(fixture.proofRecipients.every(target => target === recipient)).toBe(true);
    expect(withdrawal!.userOperation.callData).toBe('0x');
    expect(withdrawal!.userOperation.callGasLimit).toBe('0x0');
    expect(signTypedData).toHaveBeenCalled();
  });

  it('treats an explicit empty tail-call callback as sender-funded execution', async () => {
    fixture.count = 1;
    fixture.estimate.mockResolvedValue(reasonableGasUnitsForBatch(false, 0, true));
    const tailCalls = vi.fn(async () => []);
    const [withdrawal] = await prepare({ mode: 'smart-account', signer: owner, allowUsed: true,
      account: { kind: 'simple-account', address: accountAddress } }, { tailCalls, recipient: BigInt(accountAddress) });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(fixture.proofRecipients.every(recipient => recipient === BigInt(accountAddress))).toBe(true);
    expect(BigInt(withdrawal!.userOperation.callGasLimit)).toBeGreaterThan(0n);
    expect(withdrawal!.userOperation.callData).toBe('0x');
    expect(tailCalls).toHaveBeenCalledWith(accountAddress);
  });

  it.each((['smart-account', 'external'] as const).flatMap(mode => [1, 2].map(count => ({ mode, count }))))('explicitly retries $mode execution shortages for $count note(s) within the ceiling', async ({ mode, count }) => {
    fixture.count = count;
    const base = reasonableGasUnitsForBatch(false, count - 1, true);
    const required = base.callGasLimit + 150_000n;
    const seen: bigint[] = [];

    fixture.estimate.mockImplementation(async (op: SerializedUserOperation) => {
      const gas = BigInt(op.callGasLimit);

 seen.push(gas);

      if (gas < required) throw executionOutOfGas();

      return { ...base, callGasLimit: required };
    });
    const delegation: DelegationConfig = mode === 'smart-account'
      ? { mode, allowUsed: true, signer: owner, account: { kind: 'simple-account', address: accountAddress } }
      : { mode, allowUsed: true, signer: owner };
    const [withdrawal] = await prepare(delegation, {
      executionGasRetry: true,
      tailCalls: async () => [{ to: owner.address, value: 0n, data: '0x' }], maxGasLimits: { callGasLimit: base.callGasLimit * 3n },
    });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(seen).toEqual([base.callGasLimit, base.callGasLimit * 2n, base.callGasLimit * 2n]);
    expect(withdrawal!.gasEstimation!.status).toBe('estimated');
  });

  it.each([undefined, false])('does not treat a ceiling as retry opt-in (executionGasRetry=%s)', async executionGasRetry => {
    fixture.estimate.mockRejectedValue(executionOutOfGas());
    await expect(prepare({ mode: 'smart-account', allowUsed: true, signer: owner, account: { kind: 'simple-account', address: accountAddress } }, {
      executionGasRetry, maxGasLimits: { callGasLimit: 8_000_000n }, tailCalls: async () => [],
    })).rejects.toMatchObject({ message: expect.stringContaining('preparation stopped') });
    expect(fixture.estimate).toHaveBeenCalledOnce();
    expect(fixture.simulatedFees.filter(fee => fee > 0n)).toHaveLength(1);
    expect(fixture.fees).toHaveLength(0);
  });

  it.each([undefined, 0n, -1n, 1_000_000])('rejects retry opt-in without a valid positive ceiling (%s) before signing', async callGasLimit => {
    await expect(prepare(null, { executionGasRetry: true, maxGasLimits: { callGasLimit } })).rejects.toMatchObject({ message: expect.stringContaining('requires a positive') });
    expect(fixture.fees).toHaveLength(0);
    expect(fixture.deriveSignature).not.toHaveBeenCalled();
  });

  it('rejects an invalid retry flag before signing', async () => {
    await expect(prepare(null, { executionGasRetry: 'true', maxGasLimits: { callGasLimit: 8_000_000n } })).rejects.toMatchObject({ message: expect.stringContaining('must be a boolean') });
    expect(fixture.fees).toHaveLength(0);
    expect(fixture.deriveSignature).not.toHaveBeenCalled();
  });
  it('pins a caller-selected compatible 7702 target in the authorization', async () => {
    fixture.count = 2;
    fixture.estimate.mockResolvedValue({ ...reasonableGasUnitsForBatch(false, 1, false), preVerificationGas: 281_260n });
    const [withdrawal] = await prepare({ mode: 'external', allowUsed: true, signer: owner, implementation: accountAddress });

    if (withdrawal!.mode !== 'paymaster') throw new Error('Expected paymaster');

    expect(withdrawal!.userOperation.eip7702Auth!.address).toBe(accountAddress);
  });
  it('never falls back when a deployed account cannot be simulated', async () => {
    fixture.estimate.mockRejectedValue(new Error('network timeout'));
    await expect(prepare({ mode: 'smart-account', allowUsed: true, signer: owner, nonce: 0n, account: { kind: 'simple-account', address: accountAddress } })).rejects.toThrow('gas estimation failed');
  });
});
