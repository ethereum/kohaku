import { describe, expect, it, vi } from 'vitest';
import type { EthereumProvider, TxLog } from '@kohaku-eth/provider';
import { DataService } from '../../src/data/data.service';
import { EthClient } from '../../src/data/eth-client';
import type { Address } from '../../src/interfaces/types.interface';

const POOL = 0xaan as Address;
const HEAD = 1_000n;

// A fake provider whose `eth_getCode` answers with `codeAt(block)`.
const makeProvider = (codeAt: (block: bigint) => unknown, head = HEAD) => {
  const request = vi.fn(async ({ params }: { method: string; params: [string, string] }) =>
    codeAt(BigInt(params[1])));
  const getLogs = vi.fn(async () => []);

  return {
    request,
    getLogs,
    getBlockNumber: vi.fn(async () => head),
  } as unknown as EthereumProvider & { request: typeof request; getLogs: typeof getLogs };
};

describe('EthClient.getDeploymentBlock', () => {
  it('finds the first block holding code', async () => {
    const client = new EthClient(makeProvider((block) => (block >= 321n ? '0x6080' : '0x')));

    await expect(client.getDeploymentBlock(POOL)).resolves.toBe(321n);
  });

  it('throws instead of returning the head when the address has no code', async () => {
    const client = new EthClient(makeProvider(() => '0x'));

    await expect(client.getDeploymentBlock(POOL)).rejects.toThrow(/No code/);
  });

  it.each([null, undefined, '', '0x0', 'deployed', { code: '0x60' }])(
    'throws on a malformed eth_getCode response (%j)',
    async (response) => {
      const client = new EthClient(makeProvider(() => response));

      await expect(client.getDeploymentBlock(POOL)).rejects.toThrow(/Malformed eth_getCode/);
    },
  );

  it('throws when the search starts past the head', async () => {
    const client = new EthClient(makeProvider(() => '0x6080'));

    await expect(client.getDeploymentBlock(POOL, HEAD + 1n)).rejects.toThrow(/past the chain head/);
  });
});

describe('EthClient.getLogs', () => {
  it('splits dense pages and returns every log once with the complete cursor', async () => {
    const logs: TxLog[] = Array.from({ length: 10_002 }, (_, index) => ({
      address: '0xaa', blockNumber: index < 5_001 ? 0n : 1n, logIndex: index, data: '0x', topics: [],
    }));
    const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs.filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock));
    const client = new EthClient({ getLogs } as unknown as EthereumProvider);

    const result = await client.getLogs({ address: '0xaa', fromBlock: 0n, toBlock: 3n });

    expect(getLogs.mock.calls.map(([range]) => [range.fromBlock, range.toBlock])).toEqual([[0n, 3n], [0n, 1n], [0n, 0n], [1n, 2n], [3n, 3n]]);
    expect(result).toEqual({ logs, fromBlock: 0n, toBlock: 3n });
  });

  it('rejects a single block exceeding the log count or payload budget', async () => {
    const log: TxLog = { address: '0xaa', blockNumber: 0n, data: '0x', topics: [] };

    for (const logs of [Array<TxLog>(10_001).fill(log), [{ ...log, data: '0x' + '00'.repeat(2 * 1024 * 1024) }]]) {
      const getLogs = vi.fn(async () => logs);
      const client = new EthClient({ getLogs } as unknown as EthereumProvider);

      await expect(client.getLogs({ address: '0xaa', fromBlock: 0n, toBlock: 0n })).rejects.toThrow('RPC log page exceeds limits');
      expect(getLogs).toHaveBeenCalledOnce();
    }
  });

  it('does not advance the cursor over an empty range', async () => {
    const provider = makeProvider(() => '0x');
    const client = new EthClient(provider);

    const result = await client.getLogs({ address: '0xaa', fromBlock: HEAD + 50n });

    expect(provider.getLogs).not.toHaveBeenCalled();
    expect(result.logs).toEqual([]);
    expect(result.toBlock).toBe(HEAD + 49n);
  });

  it('splits a range into chunks that never repeat a block', async () => {
    const provider = makeProvider(() => '0x');
    const client = new EthClient(provider);

    await client.getLogs({ address: '0xaa', fromBlock: 0n, toBlock: 25n, maxQuerySize: 10n });

    expect(provider.getLogs.mock.calls.map(([range]) => [range.fromBlock, range.toBlock])).toEqual([
      [0n, 9n], [10n, 19n], [20n, 25n],
    ]);
  });

  it('reports the head as the cursor for a non-empty range', async () => {
    const provider = makeProvider(() => '0x');
    const client = new EthClient(provider);

    const result = await client.getLogs({ address: '0xaa', fromBlock: HEAD - 10n });

    expect(provider.getLogs).toHaveBeenCalledTimes(1);
    expect(result.toBlock).toBe(HEAD);
  });
});

describe('DataService.getPoolEvents', () => {
  it('honours an explicit toBlock of 0 instead of scanning to the head', async () => {
    const provider = makeProvider(() => '0x');
    const dataService = new DataService({ provider });

    const result = await dataService.getPoolEvents({
      events: ['Deposited', 'Withdrawn'],
      address: POOL,
      fromBlock: 0n,
      toBlock: 0n,
    });

    expect(provider.getBlockNumber).not.toHaveBeenCalled();
    expect(provider.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 0n, toBlock: 0n }));
    expect(result.toBlock).toBe(0n);
  });
});
