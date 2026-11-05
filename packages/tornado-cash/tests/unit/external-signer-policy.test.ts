import { afterEach, describe, expect, it, vi } from 'vitest';
import { transferHandlers, wrap } from 'comlink';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address, getUserOperationTypedData } from 'viem/account-abstraction';
import type { DelegatorAccount } from '../../src/account/delegation.interface';
import { SIMPLE_7702_IMPLEMENTATION } from '../../src/paymaster/utils';
import { exposeOnly, registerHostBridge } from '../../src/plugin/host-bridge';
import { externalSignerPolicy } from '../../src/plugin/external-signer-policy';

const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
const paymasterAddress = '0x0000000000000000000000000000000000000004';
const scope = { address: account.address, chainId: 1, nonce: 0n, entryPointAddress: entryPoint08Address, paymasterAddress } as const;
const authorization = { address: SIMPLE_7702_IMPLEMENTATION, chainId: 1, nonce: 0 };
const typedData = () => getUserOperationTypedData({ chainId: 1, entryPointAddress: entryPoint08Address,
  userOperation: { sender: account.address, nonce: 0n, callData: '0x', callGasLimit: 100_000n, verificationGasLimit: 100_000n, preVerificationGas: 100_000n,
    maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, paymaster: paymasterAddress, paymasterData: '0x', paymasterPostOpGasLimit: 1n, paymasterVerificationGasLimit: 1n, signature: '0x' } });
const ports: MessagePort[] = [];
afterEach(() => ports.splice(0).forEach(p => p.close()));
function remoteSigner() {
  const signAuthorization = vi.fn(account.signAuthorization), signTypedData = vi.fn(account.signTypedData);
  const signer = { ...account, signAuthorization, signTypedData, privateKey: 'must never be readable' };
  registerHostBridge();
  const [port] = transferHandlers.get('kohaku:host-bridge')!.serialize(exposeOnly(signer, externalSignerPolicy(scope))) as [MessagePort, Transferable[]];
  ports.push(port);
  return { remote: wrap<DelegatorAccount>(port), signAuthorization, signTypedData };
}
describe('scoped external signing over the actual host bridge', () => {
  it('delivers the two valid signing methods as asynchronous host calls', async () => {
    const { remote, signAuthorization, signTypedData } = remoteSigner();
    expect((await remote.signAuthorization(authorization)).address).toBe(SIMPLE_7702_IMPLEMENTATION);
    expect(await remote.signTypedData(typedData())).toMatch(/^0x[0-9a-f]{130}$/);
    expect(signAuthorization).toHaveBeenCalledOnce(); expect(signTypedData).toHaveBeenCalledOnce();
  });
  it('blocks field reads and unexposed signing methods', async () => {
    const { remote, signAuthorization, signTypedData } = remoteSigner();
    await expect((remote as unknown as { privateKey: Promise<string> }).privateKey).rejects.toThrow('not exposed');
    await expect((remote as unknown as { signMessage: (data: object) => Promise<string> }).signMessage({ message: 'test' })).rejects.toThrow('not exposed');
    expect(signAuthorization).not.toHaveBeenCalled(); expect(signTypedData).not.toHaveBeenCalled();
  });
  it('refuses another chain, nonce or delegation target before contacting the signer', async () => {
    const { remote, signAuthorization } = remoteSigner();
    for (const bad of [{ ...authorization, chainId: 0 }, { ...authorization, nonce: 1 }, { ...authorization, address: paymasterAddress }]) {
      await expect(remote.signAuthorization(bad)).rejects.toThrow('outside');
    }
    expect(signAuthorization).not.toHaveBeenCalled();
  });
  it('refuses unrelated typed data, changed domains, senders, paymasters and nonces', async () => {
    const { remote, signTypedData } = remoteSigner();
    const changes: Array<(data: ReturnType<typeof typedData>) => void> = [
      d => { d.domain!.chainId = 11155111 }, d => { d.domain!.verifyingContract = paymasterAddress },
      d => { d.message.sender = paymasterAddress }, d => { d.message.nonce = 1n }, d => { d.message.paymasterAndData = '0x' },
      d => { (d as unknown as { primaryType: string }).primaryType = 'Permit' },
      d => { Object.assign(d, { account: paymasterAddress }) },
    ];
    for (const mutate of changes) { const data = typedData(); mutate(data); await expect(remote.signTypedData(data)).rejects.toThrow('outside'); }
    expect(signTypedData).not.toHaveBeenCalled();
  });
});
