import { describe, expect, it } from 'vitest';
import type { DelegationConfig } from '../../src/interfaces/user-ops.interface';
import { SIMPLE_7702_IMPLEMENTATION, executionAccount, executionGasBaseline, simpleAccountFactoryData, prepareExecutionAccount } from '../../src/account/execution-account';
import { decodeFunctionData } from 'viem';
const owner = '0x0000000000000000000000000000000000000044';
const sender = '0x0000000000000000000000000000000000000099';
const signTypedData = async () => '0x' as const;
const config: DelegationConfig = { mode: 'smart-account', signer: { address: owner, signTypedData }, nonce: 0n,
  account: { kind: 'simple-account', address: sender } };
describe('execution account configuration', () => {
  it.each([-1n, 2n ** 256n])('rejects an invalid or absent smart-account nonce: %s', nonce => {
    expect(() => executionAccount({ ...config, nonce } as DelegationConfig)).toThrow('nonce');
  });
  it('rejects the zero delegation address rather than signing a revocation', () => {
    expect(() => executionAccount({ mode: 'random', implementation: `0x${'00'.repeat(20)}` })).toThrow('cannot be zero');
  });
  it('rejects malformed deployment parameters', () => {
    expect(() => executionAccount({ ...config, account: { ...config.account, factory: { address: owner, salt: -1n } } })).toThrow('factory');
  });
  it('budgets factory creation without changing existing-account verification gas', () => {
    const gas = { verificationGasLimit: 100_000n };
    expect(executionGasBaseline(config.account, gas)).toBe(gas);
    expect(executionGasBaseline({ ...config.account, factory: { address: owner, salt: 7n } }, gas).verificationGasLimit).toBe(500_000n);
  });
  it('encodes the selected external owner and salt, not the sender address', () => {
    const decoded = decodeFunctionData({ abi: [{ type: 'function', name: 'createAccount', stateMutability: 'nonpayable',
      inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'address' }] }], data: simpleAccountFactoryData(owner, { salt: 7n }) });
    expect(decoded.args).toEqual([owner, 7n]);
  });
});


it.each(['eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_call'])('rejects touched sender state from %s without allowUsed', async touched => {
  const provider = { request: async ({ method }: { method: string }) => {
    if (method === 'eth_getCode') return touched === method ? '0x6000' : '0x';
    if (method === 'eth_call') return `0x${(touched === method ? '1' : '0').padStart(64, '0')}`;
    return touched === method ? '0x1' : '0x0';
  } };
  const signer = { address: owner, signTypedData, signAuthorization: async () => { throw new Error('must not sign'); } };
  await expect(prepareExecutionAccount(undefined, signer, provider as never, owner)).rejects.toThrow('allowUsed: true');
});

it('reads the current nonce and omits deployment when explicitly reusing an existing account', async () => {
  const provider = { request: async ({ method }: { method: string }) => {
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_call') return `0x${'7'.padStart(64, '0')}`;
    return '0x1';
  } };
  const signer = { address: owner, signTypedData, signAuthorization: async () => { throw new Error('must not sign'); } };
  const result = await prepareExecutionAccount({ ...config, nonce: undefined, allowUsed: true, account: { ...config.account, factory: { address: owner, salt: 0n } } }, signer, provider as never, owner);
  expect(result.nonce).toBe(7n);
  expect(result.account.kind === 'simple-account' && result.account.factory).toBeUndefined();
  const gas = { verificationGasLimit: 50_000n };
  expect(executionGasBaseline(result.account, gas)).toBe(gas);
});

it('rejects an explicitly supplied stale nonce before any signing', async () => {
  const provider = { request: async ({ method }: { method: string }) => method === 'eth_getCode' ? '0x6000' : method === 'eth_call' ? `0x${'7'.padStart(64, '0')}` : '0x0' };
  const signer = { address: owner, signTypedData, signAuthorization: async () => { throw new Error('must not sign'); } };
  await expect(prepareExecutionAccount({ ...config, allowUsed: true, nonce: 6n }, signer, provider as never, owner)).rejects.toThrow('does not match');
});


it.each((['external', 'wallet-path'] as const).flatMap(mode => [undefined, owner].map(implementation => ({ mode, implementation }))))('reuses a $mode EOA with its selected delegation ($implementation)', async ({ mode, implementation }) => {
  const signer = { address: owner, signTypedData, signAuthorization: async () => { throw new Error('must not sign'); } };
  const delegation: DelegationConfig = mode === 'external' ? { mode, signer, implementation } : { mode: 'deterministic', path: "m/44'/60'/0'/0/3", implementation };
  const provider = { request: async ({ method }: { method: string }) => {
    if (method === 'eth_getCode') return `0xef0100${(implementation ?? SIMPLE_7702_IMPLEMENTATION).slice(2)}`;
    if (method === 'eth_call') return `0x${'7'.padStart(64, '0')}`;
    return '0x5';
  } };
  const result = await prepareExecutionAccount(delegation, signer, provider as never, owner);
  expect(result.authorizationNonce).toBe(5n);
  expect(result.nonce).toBe(7n);
});

it.each([false, undefined])('does not implicitly reuse an EOA delegated to another implementation (allowUsed=%s)', async allowUsed => {
  const signer = { address: owner, signTypedData, signAuthorization: async () => { throw new Error('must not sign'); } };
  const provider = { request: async ({ method }: { method: string }) => {
    if (method === 'eth_getCode') return `0xef0100${owner.slice(2)}`;
    if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
    return '0x0';
  } };
  await expect(prepareExecutionAccount({ mode: 'external', signer, allowUsed }, signer, provider as never, owner)).rejects.toThrow(allowUsed === false ? 'appears touched' : 'different implementation');
  expect((await prepareExecutionAccount({ mode: 'external', signer, allowUsed: true }, signer, provider as never, owner)).authorizationNonce).toBe(0n);
});
