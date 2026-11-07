import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expose, releaseProxy, wrap } from 'comlink';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address } from 'viem/account-abstraction';
import { exposeOnly, registerHostBridge } from '../../src/plugin/host-bridge';
import { externalSignerPolicy } from '../../src/plugin/external-signer-policy';
import { workerApi, type WorkerApi } from '../../src/state/state-manager-api';
import { buildSignedTornadoUserOp } from '../../src/paymaster/utils';
import type { IPaymasterWithdrawParams } from '../../src/plugin/interfaces/protocol-params.interface';

const { prepare } = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('../../src/state/state-manager', () => ({ storeStateManager: async () => ({ getWithdrawalPayloads: prepare }) }));
vi.mock('../../src/data/data.service', () => ({ DataService: class {} }));
vi.mock('../../src/data/sync.service', () => ({ SyncService: class {} }));
const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
const paymasterAddress = '0x0000000000000000000000000000000000000004';
const ports: MessagePort[] = [];
afterEach(() => ports.splice(0).forEach(p => p.close()));
beforeEach(async () => {
  prepare.mockReset();
  await workerApi.init(...[{}, {}, {}, {}, async () => ({}), async () => ({}), undefined, undefined,
    { protocolConfig: {}, accountIndex: 0, paymasterConfig: {} }] as unknown as Parameters<typeof workerApi.init>);
});
function remoteWorker() {
  registerHostBridge();
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2); expose(workerApi, port1);
  return wrap<WorkerApi>(port2);
}
const params = { mode: 'paymaster', asset: 0n, amount: 1n, recipient: BigInt(account.address), delegation: { mode: 'external', address: account.address } } as const;
describe('external signer delivery through the worker API', () => {
  it('reconstructs a signer from cloneable options and separate callbacks over real message ports', async () => {
    prepare.mockImplementation(async (full: IPaymasterWithdrawParams) => {
      if (full.delegation?.mode !== 'external') throw new Error('Expected external signer');
      const operation = await buildSignedTornadoUserOp({ signer: full.delegation.signer, chainId: 1, paymasterAddress, paymasterData: '0x',
        gas: { callGasLimit: 100_000n, verificationGasLimit: 100_000n, preVerificationGas: 100_000n, paymasterVerificationGasLimit: 100_000n, paymasterPostOpGasLimit: 100_000n },
        maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
      return [{ mode: 'paymaster', userOperation: operation }];
    });
    const signAuthorization = vi.fn(account.signAuthorization), signTypedData = vi.fn(account.signTypedData);
    const hostSigner = exposeOnly({ ...account, signAuthorization, signTypedData }, externalSignerPolicy({ address: account.address, chainId: 1, nonce: 0n, entryPointAddress: entryPoint08Address, paymasterAddress }));
    const remote = remoteWorker();
    const result = await remote.getWithdrawalPayloads(params, undefined, undefined, hostSigner);
    expect(result[0]).toMatchObject({ mode: 'paymaster', userOperation: { sender: account.address, nonce: '0x0' } });
    expect(signAuthorization).toHaveBeenCalledOnce(); expect(signTypedData).toHaveBeenCalledOnce();
    const full = prepare.mock.calls[0]![0] as IPaymasterWithdrawParams;
    if (full.delegation?.mode !== 'external') throw new Error('Expected external signer');
    await expect(full.delegation.signer.signAuthorization({ address: paymasterAddress, chainId: 1, nonce: 0 })).rejects.toThrow('released');
    remote[releaseProxy]();
  });
  it('fails closed if external signing callbacks are missing', async () => {
    const remote = remoteWorker();
    await expect(remote.getWithdrawalPayloads(params)).rejects.toThrow('requires host signing callbacks');
    expect(prepare).not.toHaveBeenCalled(); remote[releaseProxy]();
  });
});

it('carries a smart account and exposes only its owner typed-data signing capability', async () => {
  const sender = '0x0000000000000000000000000000000000000099';
  prepare.mockImplementation(async (full: IPaymasterWithdrawParams) => {
    if (full.delegation?.mode !== 'smart-account') throw new Error('Expected smart account');
    const { externalAccountSigner } = await import('../../src/account/execution-account');
    const operation = await buildSignedTornadoUserOp({ signer: externalAccountSigner(full.delegation), executionAccount: full.delegation.account,
      nonce: full.delegation.nonce, chainId: 1, paymasterAddress, paymasterData: '0x',
      gas: { callGasLimit: 0n, verificationGasLimit: 100_000n, preVerificationGas: 100_000n, paymasterVerificationGasLimit: 100_000n, paymasterPostOpGasLimit: 100_000n },
      maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    return [{ mode: 'paymaster', userOperation: operation }];
  });
  const signTypedData = vi.fn(account.signTypedData);
  const hostSigner = exposeOnly({ address: account.address, signTypedData }, externalSignerPolicy({ address: account.address, sender,
    smartAccount: true, userOpNonce: 3n, chainId: 1, nonce: 0n, entryPointAddress: entryPoint08Address, paymasterAddress }));
  const remote = remoteWorker();
  const result = await remote.getWithdrawalPayloads({ ...params, delegation: { mode: 'smart-account', owner: account.address, nonce: 3n,
    account: { kind: 'simple-account', address: sender } } }, undefined, undefined, hostSigner);
  expect(result[0]).toMatchObject({ userOperation: { sender, nonce: '0x3' } });
  expect(result[0]!.mode === 'paymaster' && result[0]!.userOperation).not.toHaveProperty('eip7702Auth');
  expect(signTypedData).toHaveBeenCalledOnce(); remote[releaseProxy]();
});
