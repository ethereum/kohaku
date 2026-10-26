import { describe, expect, it, vi } from 'vitest';

import type { Host } from '@kohaku-eth/plugins';
import { E_ADDRESS, TornadoCashConfigs } from '../../src/config';
import { TornadoCashProtocol } from '../../src/plugin/base';
import { DepositStrategy } from '../../src/state/thunks/getDepositPayloadThunk';

const { remote } = vi.hoisted(() => ({
  remote: {
    init: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    getDepositPayload: vi.fn(async () => []),
  },
}));

vi.mock('#worker-loader', () => ({
  loadStateManagerWorker: () => ({ remote, onError: () => {} }),
}));

const host = { provider: {}, keystore: {}, storage: {}, network: { fetch } } as unknown as Host;
const eth = { asset: { contract: E_ADDRESS, __type: 'erc20' as const }, amount: 10n ** 17n };

describe('prepareShield strategy', () => {
  it.each([
    ['MaxAnonimitySet (enum value 0)', { strategy: DepositStrategy.MaxAnonimitySet }, DepositStrategy.MaxAnonimitySet],
    ['MinFee', { strategy: DepositStrategy.MinFee }, DepositStrategy.MinFee],
    ['omitted', undefined, DepositStrategy.MinFee],
  ])('passes %s through', async (_name, options, expected) => {
    remote.getDepositPayload.mockClear();

    const protocol = new TornadoCashProtocol(host, { protocolConfig: TornadoCashConfigs[1] });

    await protocol.prepareShield(eth, options);

    expect(remote.getDepositPayload).toHaveBeenCalledWith(expect.objectContaining({ strategy: expected }));
  });
});
