import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { getUserOperationTypedData, entryPoint08Address } from 'viem/account-abstraction';
import { decodeAbiParameters, parseAbiParameters, toHex } from 'viem';
import { verifiedExternalDelegator } from '../../src/account/external-delegator';
import type { DelegatorAccount, DelegationConfig, SerializedUserOperation } from '../../src/interfaces/user-ops.interface';
import { E_ADDRESS } from '../../src/config';
import { SIMPLE_7702_IMPLEMENTATION } from '../../src/paymaster/utils';
import { reasonableGasUnits, reasonableGasUnitsForBatch } from '../../src/paymaster/fee';
import { paymasterWithdrawThunk } from '../../src/state/thunks/paymasterWithdrawThunk';
import { storeFactory } from '../../src/state/store';
import type { NoteToSpend } from '../../src/state/selectors/notes.selector';

const fixture = vi.hoisted(() => ({
  count: 1, isERC20: false, nonce: 0, deployed: false,
  estimate: vi.fn(), proof: vi.fn(),
  deriveEphemeral: vi.fn(async () => `0x${'01'.repeat(32)}` as const),
  deriveDelegator: vi.fn(async () => `0x${'02'.repeat(32)}` as const),
  getTransactionCount: vi.fn(async () => 0),
}));
vi.mock('../../src/state/selectors/slices.selectors', () => ({ entrypointInfoSelector: () => ({ chainId: 1n, entrypointAddress: 900n }) }));
vi.mock('../../src/state/selectors/pools.selector', () => ({ poolFromAssetSelector: () => ({ address: 1n, asset: fixture.isERC20 ? 2n : BigInt(E_ADDRESS), scope: 1n }) }));
vi.mock('../../src/state/selectors/notes.selector', () => ({
  getNoteSelector: () => ({ deposit: 0, withdraw: 0, balance: 10n ** 18n }),
  getNotesToSpendSelector: () => Array.from({ length: fixture.count }, (_, i) => ({ note: { deposit: i, withdraw: 0, balance: 10n ** 18n }, withdrawnValue: 10n ** 18n })),
}));
vi.mock('../../src/state/thunks/withdrawThunk', () => ({ withdrawThunk: (params: unknown) => async () => {
  fixture.proof(params);
  return { payload: { proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['1', '2', '1'] }, publicSignals: Array(8).fill('0'), mappedSignals: {} } };
} }));
vi.mock('../../src/paymaster/utils', async original => ({
  ...await original<typeof import('../../src/paymaster/utils')>(),
  createPaymasterBundlerClient: () => ({}),
  getUserOperationGasPrice: async () => ({ standard: { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } }),
  estimateUserOperationGas: (_client: unknown, op: SerializedUserOperation) => fixture.estimate(op),
}));
const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'08'.repeat(32)}`);
const paymasterAddress = '0x0000000000000000000000000000000000000004';
const adapter = '0x0000000000000000000000000000000000000005';
const recipient = '0x0000000000000000000000000000000000000003';
const scope = () => ({ chainId: 1, nonce: BigInt(fixture.nonce), entryPointAddress: entryPoint08Address, paymasterAddress } as const);
const authorization = () => ({ address: SIMPLE_7702_IMPLEMENTATION, chainId: 1, nonce: fixture.nonce });
const typedData = () => getUserOperationTypedData({ chainId: 1, entryPointAddress: entryPoint08Address,
  userOperation: { sender: account.address, nonce: 0n, callData: '0x', callGasLimit: 0n, verificationGasLimit: 100_000n, preVerificationGas: 100_000n,
    maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, paymaster: paymasterAddress, paymasterData: '0x', paymasterVerificationGasLimit: 100_000n, paymasterPostOpGasLimit: 100_000n, signature: '0x' } });
function externalSigner() {
  const signAuthorization = vi.fn(account.signAuthorization), signTypedData = vi.fn(account.signTypedData);
  return { address: account.address, signAuthorization, signTypedData } as DelegatorAccount & { signAuthorization: typeof signAuthorization; signTypedData: typeof signTypedData };
}
async function prepare(delegation?: DelegationConfig, tailCalls?: () => Promise<[]>, notesToSpend?: NoteToSpend[]) {
  const store = storeFactory({ logLevel: 'off', entrypointInfo: { chainId: 1n, entrypointAddress: 900n, deploymentBlock: 0n } });
  return store.dispatch(paymasterWithdrawThunk({
    dataService: { getTransactionCount: fixture.getTransactionCount, quoteWeiInToken: async (_paymaster: bigint, _asset: bigint, fee: bigint) => fee * 7n },
    provider: { request: async ({ method }: { method: string }) => {
      if (method === 'eth_getCode') return delegation?.mode === 'smart-account' && (fixture.deployed || !delegation.account.factory) ? '0x6000' : '0x';
      if (method === 'eth_getBalance' || method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_call') return toHex(delegation?.nonce ?? 0n, { size: 32 });
      return method === 'eth_getBlockByNumber' ? { baseFeePerGas: toHex(1_000_000_000_000n) } : toHex(1n);
    } },
    secretManager: { deriveEphemeralSigner: fixture.deriveEphemeral, deriveDelegatorSigner: fixture.deriveDelegator },
    paymasterConfig: { paymasterAddress, entryPointAddress: entryPoint08Address, bundlerUrl: 'unused', poolsAccountsMap: { '0x0000000000000000000000000000000000000001': adapter } },
    recipient: BigInt(recipient), asset: fixture.isERC20 ? 2n : BigInt(E_ADDRESS),
    amount: notesToSpend?.reduce((sum, n) => sum + n.withdrawnValue, 0n) ?? BigInt(fixture.count) * 10n ** 18n,
    batch: fixture.count > 1, delegation, tailCalls, notesToSpend, getNextNote: vi.fn(), proverFactory: vi.fn(),
  } as never)).unwrap();
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.count = 1; fixture.isERC20 = false; fixture.nonce = 0; fixture.deployed = false;
  fixture.getTransactionCount.mockImplementation(async () => fixture.nonce);
  fixture.estimate.mockReset();
  fixture.estimate.mockImplementation(async (op: SerializedUserOperation) => ({
    ...reasonableGasUnits(fixture.isERC20), callGasLimit: op.callData === '0x' ? 9_000n : reasonableGasUnitsForBatch(fixture.isERC20, fixture.count - 1, false).callGasLimit,
  }));
});

describe('Privacy Pools external paymaster signing', () => {
  it.each([false, true])('keeps planned partial amounts through proof refinement and forwarding, ERC20=%s', async isERC20 => {
    fixture.count = 2; fixture.isERC20 = isERC20;
    const balances = [970_000_000_000_000_000n, 930_000_000_000_000_000n];
    const notesToSpend = balances.map((withdrawnValue, deposit) => ({
      note: { deposit, withdraw: 0, balance: 10n ** 18n }, withdrawnValue,
    })) as NoteToSpend[];
    const [withdrawal] = await prepare({ mode: 'external', signer: externalSigner() }, undefined, notesToSpend);
    expect(withdrawal!.withdrawnValue).toBe(1_900_000_000_000_000_000n);
    // The direct note is proved once; both sponsoring proofs use the same partial amount.
    const proofParams = fixture.proof.mock.calls.map(call => call[0]);
    expect(proofParams.filter(p => p.note.deposit === 1).map(p => p.amount)).toEqual([balances[1]]);
    expect(proofParams.filter(p => p.note.deposit === 0).map(p => p.amount)).toEqual([balances[0], balances[0]]);
    const { decodeFunctionData, erc20Abi } = await import('viem');
    const { SIMPLE_7702_EXECUTE_ABI } = await import('../../src/data/abis/account.abi');
    const decoded = decodeFunctionData({ abi: SIMPLE_7702_EXECUTE_ABI, data: withdrawal!.userOperation.callData });
    const calls = decoded.args[0] as readonly { target: string; value: bigint; data: `0x${string}` }[];
    expect(calls).toHaveLength(2);
    const forward = calls[1]!;
    const expected = withdrawal!.withdrawnValue - withdrawal!.fee;
    if (isERC20) {
      expect(decodeFunctionData({ abi: erc20Abi, data: forward.data }).args).toEqual([recipient, expected]);
    } else {
      expect(forward.value).toBe(expected);
      expect(forward.target).toBe(recipient);
    }
  });
  it.each([{ count: 1, isERC20: false }, { count: 2, isERC20: false }, { count: 2, isERC20: true }])('requests host signatures for $count notes, ERC20=$isERC20', async ({ count, isERC20 }) => {
    fixture.count = count; fixture.isERC20 = isERC20;
    const signer = externalSigner();
    const [withdrawal] = await prepare({ mode: 'external', allowUsed: true, signer });
    expect(withdrawal!.userOperation.sender).toBe(account.address);
    expect(withdrawal!.userOperation.nonce).toBe('0x0');
    expect(withdrawal!.userOperation.eip7702Auth!.nonce).toBe('0x0');
    expect(withdrawal!.withdrawnValue).toBe(BigInt(count) * 10n ** 18n);
    expect(signer.signAuthorization).toHaveBeenCalledTimes(1);
    expect(signer.signTypedData).toHaveBeenCalledTimes(2);
    expect(fixture.estimate).toHaveBeenCalledTimes(2);
    expect(fixture.estimate).toHaveBeenLastCalledWith(withdrawal!.userOperation);
    expect(fixture.deriveEphemeral).not.toHaveBeenCalled(); expect(fixture.deriveDelegator).not.toHaveBeenCalled();
    const [{ adapterData }] = decodeAbiParameters(parseAbiParameters('(address adapter, bytes adapterData)'), withdrawal!.userOperation.paymasterData!);
    const [{ withdrawal: payload }] = decodeAbiParameters(parseAbiParameters('((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'), adapterData);
    const [{ recipient: payout, refundRecipient }] = decodeAbiParameters(parseAbiParameters('(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'), payload.data);
    expect(payout.toLowerCase()).toBe((count > 1 ? account.address : recipient).toLowerCase());
    expect(refundRecipient.toLowerCase()).toBe(recipient.toLowerCase());
    if (count === 1) expect(withdrawal!.userOperation.callGasLimit).toBe('0x0');
  });
  it('uses the external EOA transaction nonce independently of EntryPoint nonce zero', async () => {
    fixture.nonce = 7;
    const signer = externalSigner(), [withdrawal] = await prepare({ mode: 'external', signer });
    expect(fixture.getTransactionCount).toHaveBeenCalledExactlyOnceWith(account.address);
    expect(withdrawal!.userOperation.eip7702Auth!.nonce).toBe('0x7');
    expect(withdrawal!.userOperation.nonce).toBe('0x0');
  });
  it('supports external signing with user tail calls', async () => {
    const signer = externalSigner(), [withdrawal] = await prepare({ mode: 'external', allowUsed: true, signer }, async () => []);
    expect(signer.signTypedData).toHaveBeenCalledTimes(2);
    expect(withdrawal!.userOperation.callData).toBe('0x');
  });
  it.each(['authorization', 'userop', 'authorization-rejected', 'userop-rejected'] as const)('fails closed for %s without deriving another key', async mode => {
    const signer: DelegatorAccount = { address: account.address,
      signAuthorization: mode === 'authorization' ? other.signAuthorization : mode === 'authorization-rejected' ? async () => { throw new Error('User rejected authorization'); } : account.signAuthorization,
      signTypedData: mode === 'userop' ? other.signTypedData : mode === 'userop-rejected' ? async () => { throw new Error('User rejected operation'); } : account.signTypedData };
    await expect(prepare({ mode: 'external', allowUsed: true, signer })).rejects.toThrow(mode.includes('rejected') ? 'User rejected' : 'does not match');
    expect(fixture.estimate).not.toHaveBeenCalled();
    expect(fixture.deriveEphemeral).not.toHaveBeenCalled(); expect(fixture.deriveDelegator).not.toHaveBeenCalled();
  });
  it('propagates rejection of a refined operation without another authorization prompt', async () => {
    const signer = externalSigner();
    signer.signTypedData.mockImplementationOnce(account.signTypedData).mockRejectedValueOnce(new Error('User rejected refined operation'));
    await expect(prepare({ mode: 'external', allowUsed: true, signer })).rejects.toThrow('User rejected');
    expect(signer.signAuthorization).toHaveBeenCalledTimes(1);
    expect(signer.signTypedData).toHaveBeenCalledTimes(2);
    expect(fixture.estimate).toHaveBeenCalledTimes(1);
  });
  it('requires bundler estimation instead of returning an unestimated external operation', async () => {
    fixture.estimate.mockRejectedValue(new Error('RPC unavailable'));
    const signer = externalSigner();
    await expect(prepare({ mode: 'external', allowUsed: true, signer })).rejects.toThrow('requires successful bundler');
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
  });
  it('rejects a final payload that fails estimation or needs more gas after signing', async () => {
    const base = { ...reasonableGasUnits(false), callGasLimit: 0n };
    fixture.estimate.mockReset().mockResolvedValueOnce(base).mockRejectedValueOnce(new Error('Final estimate rejected'));
    await expect(prepare({ mode: 'external', allowUsed: true, signer: externalSigner() })).rejects.toThrow('Final estimate rejected');
    fixture.estimate.mockReset().mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, preVerificationGas: 130_000n });
    await expect(prepare({ mode: 'external', allowUsed: true, signer: externalSigner() })).rejects.toThrow('gas requirements changed');
  });
  it('preserves default note-derived and explicit wallet-path behavior', async () => {
    await prepare();
    expect(fixture.deriveEphemeral).toHaveBeenCalledOnce(); expect(fixture.getTransactionCount).not.toHaveBeenCalled();
    fixture.nonce = 7;
    const [wallet] = await prepare({ mode: 'deterministic', path: "m/44'/60'/0'/0/3" });
    expect(fixture.deriveDelegator).toHaveBeenCalledWith({ path: "m/44'/60'/0'/0/3" });
    expect(wallet!.userOperation.eip7702Auth!.nonce).toBe('0x7');
  });
});

describe('external signer scope and returned signatures', () => {
  it('caches authorization only inside one preparation and awaits delayed host responses', async () => {
    const signer = externalSigner();
    let finish!: (value: Awaited<ReturnType<DelegatorAccount['signAuthorization']>>) => void;
    signer.signAuthorization.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const verified = verifiedExternalDelegator(signer, scope());
    const first = verified.signAuthorization(authorization()), second = verified.signAuthorization(authorization());
    expect(signer.signAuthorization).toHaveBeenCalledTimes(1);
    finish(await account.signAuthorization(authorization()));
    await expect(first).resolves.toMatchObject(authorization()); await expect(second).resolves.toMatchObject(authorization());
    await verifiedExternalDelegator(signer, scope()).signAuthorization(authorization());
    expect(signer.signAuthorization).toHaveBeenCalledTimes(2);
  });
  it('refuses authorization requests outside the selected chain, executor or nonce before prompting', async () => {
    const signer = externalSigner(), verified = verifiedExternalDelegator(signer, scope());
    for (const bad of [{ ...authorization(), chainId: 0 }, { ...authorization(), address: recipient }, { ...authorization(), nonce: 1 }]) await expect(verified.signAuthorization(bad)).rejects.toThrow('outside');
    expect(signer.signAuthorization).not.toHaveBeenCalled();
  });
  it.each(['chain', 'nonce', 'target'] as const)('rejects an authorization response with a different %s', async field => {
    const signer = externalSigner();
    signer.signAuthorization.mockImplementationOnce(() => account.signAuthorization({ ...authorization(), ...(field === 'chain' ? { chainId: 11155111 } : field === 'nonce' ? { nonce: 1 } : { address: recipient }) }));
    await expect(verifiedExternalDelegator(signer, scope()).signAuthorization(authorization())).rejects.toThrow('does not match');
  });
  it('refuses unrelated typed data and account overrides before prompting', async () => {
    const signer = externalSigner(), verified = verifiedExternalDelegator(signer, scope());
    const changes: Array<(data: ReturnType<typeof typedData>) => void> = [
      d => { d.domain!.chainId = 11155111 }, d => { d.domain!.verifyingContract = recipient }, d => { d.message.sender = recipient },
      d => { d.message.nonce = 1n }, d => { d.message.paymasterAndData = '0x' }, d => { Object.assign(d, { account: recipient }) },
      d => { (d as unknown as { primaryType: string }).primaryType = 'Permit' },
    ];
    for (const change of changes) { const data = typedData(); change(data); await expect(verified.signTypedData(data)).rejects.toThrow('outside'); }
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });
  it('rejects a signature for a modified UserOperation even when signed by the selected EOA', async () => {
    const signer = externalSigner();
    signer.signTypedData.mockImplementationOnce(async () => account.signTypedData({ ...typedData(), message: { ...typedData().message, nonce: 1n } }));
    await expect(verifiedExternalDelegator(signer, scope()).signTypedData(typedData())).rejects.toThrow('does not match');
  });
});

describe('Privacy Pools execution account routes', () => {
  const accountAddress = '0x0000000000000000000000000000000000000099';
  it.each([{ deploy: false, factory: false }, { deploy: false, factory: true }, { deploy: true, factory: true }])('uses a separate account sender and typed-data-only owner (deploy=$deploy, factory=$factory)', async ({ deploy, factory }) => {
    fixture.deployed = !deploy;
    fixture.count = 2;
    const signTypedData = vi.fn(account.signTypedData);
    const [withdrawal] = await prepare({ mode: 'smart-account', allowUsed: true, signer: { address: account.address, signTypedData }, nonce: deploy ? 0n : 3n,
      account: { kind: 'simple-account', address: accountAddress, ...(factory ? { factory: { address: adapter, salt: 7n } } : {}) } });
    const op = withdrawal!.userOperation;
    expect(op.sender).toBe(accountAddress); expect(op.nonce).toBe(deploy ? '0x0' : '0x3'); expect(op).not.toHaveProperty('eip7702Auth');
    expect(!!op.factory).toBe(deploy); expect(!!op.factoryData).toBe(deploy);
    expect(BigInt(fixture.estimate.mock.calls[0]![0].verificationGasLimit)).toBe(deploy ? 500_000n : 50_000n);
    expect(signTypedData).toHaveBeenCalledTimes(2);
    expect(fixture.getTransactionCount).not.toHaveBeenCalled(); expect(fixture.deriveEphemeral).not.toHaveBeenCalled();
    const [{ adapterData }] = decodeAbiParameters(parseAbiParameters('(address adapter, bytes adapterData)'), op.paymasterData!);
    const [{ withdrawal: payload }] = decodeAbiParameters(parseAbiParameters('((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'), adapterData);
    const [{ recipient: payout }] = decodeAbiParameters(parseAbiParameters('(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'), payload.data);
    expect(payout.toLowerCase()).toBe(accountAddress.toLowerCase());
  });
  it('pins a caller-selected compatible delegation target', async () => {
    const signer = externalSigner();
    const [withdrawal] = await prepare({ mode: 'external', allowUsed: true, signer, implementation: adapter });
    expect(withdrawal!.userOperation.eip7702Auth!.address).toBe(adapter);
  });
  it('requires simulation for a deployed account without falling back', async () => {
    fixture.estimate.mockRejectedValue(new Error('offline'));
    await expect(prepare({ mode: 'smart-account', allowUsed: true, signer: account, nonce: 0n, account: { kind: 'simple-account', address: accountAddress } })).rejects.toThrow('requires successful');
  });
});
