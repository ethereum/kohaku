import type { EthereumProvider } from '@kohaku-eth/provider';
import { describe, expect, it, vi } from 'vitest';
import { EthClient } from '../../src/data/eth-client';

describe('EthClient.getLogs', () => {
  it('splits a range into chunks that never repeat a block', async () => {
    const getLogs = vi.fn(async () => []);
    const client = new EthClient({ getLogs } as unknown as EthereumProvider);

    await client.getLogs({ address: '0xaa', fromBlock: 0n, toBlock: 25n, maxQuerySize: 10n });

    expect(getLogs.mock.calls.map(([range]: [{ fromBlock: bigint; toBlock: bigint }]) => [range.fromBlock, range.toBlock]))
      .toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
  });
});
