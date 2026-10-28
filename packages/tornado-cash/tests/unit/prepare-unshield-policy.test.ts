import { describe, expect, it, vi } from 'vitest';
import type { Host } from '@kohaku-eth/plugins';
import { E_ADDRESS, TornadoCashConfigs } from '../../src/config';
import { TornadoCashProtocol } from '../../src/plugin/base';

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
});
