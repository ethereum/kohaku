import { describe, expect, it, vi } from 'vitest';
import type { Host } from '@kohaku-eth/plugins';
import { E_ADDRESS, TornadoCashConfigs } from '../../src/config';
import { TornadoCashProtocol } from '../../src/plugin/base';
import { privateKeyToAccount } from 'viem/accounts';

const { remote } = vi.hoisted(() => ({ remote: {
  init: vi.fn(async () => {}), sync: vi.fn(async () => {}),
  getWithdrawalPayloads: vi.fn(async () => [] as unknown[]),
} }));

vi.mock('#worker-loader', () => ({ loadStateManagerWorker: () => ({ remote, onError: () => {} }) }));
const host = { provider: {}, keystore: {}, storage: {}, network: { fetch } } as unknown as Host;
const eth = { asset: { contract: E_ADDRESS, __type: 'erc20' as const }, amount: 10n ** 17n };

describe('paymaster estimation policy API', () => {
  it.each(['required', 'best-effort', undefined] as const)('forwards %s policy and preserves preparation metadata', async (gasEstimationPolicy) => {
    const payload = { mode: 'paymaster', gasEstimation: { status: 'fallback', reason: 'transport-unavailable', message: 'timeout' } };

    remote.getWithdrawalPayloads.mockClear();
    remote.getWithdrawalPayloads.mockResolvedValue([payload]);
    const protocol = new TornadoCashProtocol(host, { protocolConfig: TornadoCashConfigs[1] });
    const operation = await protocol.prepareUnshield(eth, '0x0000000000000000000000000000000000000003', { mode: 'paymaster', gasEstimationPolicy });

    expect(remote.getWithdrawalPayloads).toHaveBeenCalledWith(expect.objectContaining({ mode: 'paymaster', gasEstimationPolicy }), undefined, expect.anything());
    expect(operation.withdrawals[0]).toBe(payload);
  });

  it('passes an external signer through its own bridge, leaving the worker options cloneable', async () => {
    const signer = privateKeyToAccount(`0x${'09'.repeat(32)}`);
    const provider = { getChainId: async () => 1n, request: async ({ method }: { method: string }) => method === 'eth_call' ? `0x${'0'.repeat(64)}` : '0x0' };
    remote.getWithdrawalPayloads.mockClear();
    remote.getWithdrawalPayloads.mockResolvedValue([]);
    const protocol = new TornadoCashProtocol({ ...host, provider } as unknown as Host, { protocolConfig: TornadoCashConfigs[1] });
    await protocol.prepareUnshield(eth, signer.address, { mode: 'paymaster', delegation: { mode: 'external', signer } });
    const args = remote.getWithdrawalPayloads.mock.calls[0] as unknown as unknown[];
    expect(args[0]).toMatchObject({ delegation: { mode: 'external', address: signer.address } });
    expect(() => structuredClone(args[0])).not.toThrow();
    expect((args[0] as { delegation: object }).delegation).not.toHaveProperty('signer');
    expect(args[3]).toBeDefined();
  });
});
