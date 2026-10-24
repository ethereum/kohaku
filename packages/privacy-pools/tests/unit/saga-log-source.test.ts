import type { TxLog } from '@kohaku-eth/provider';
import { describe, expect, it, vi } from 'vitest';
import type { GetLogsParams } from '../../src/data/eth-client';
import { createSagaLogSource } from '../../src/data/saga-log-source';

const SAGA_LAST = 1_000n;

// saga covers its pool up to SAGA_LAST and has nothing to stream for this test.
vi.mock('@saga-sync/client', () => ({
  HttpStore: class {},
  Client: class {
    fetchManifest = async () => ({ lastCoveredBlock: () => SAGA_LAST });
    resolveProtocolId = async () => 'privacy-pools-test';
    async *streamEvents() {}
  },
}));

const source = async (headBlock?: bigint) => {
  const fallback = vi.fn<(params: GetLogsParams) => Promise<TxLog[]>>(async () => []);
  const getLogs = await createSagaLogSource({ sourceUrl: 'https://saga.test', chainId: 1, headBlock, fallback });

  return { getLogs, fallback };
};

const address = '0x0000000000000000000000000000000000001000';

describe('createSagaLogSource tail', () => {
  it('fetches the blocks a headBlock clamp kept from saga over RPC', async () => {
    const { getLogs, fallback } = await source(800n);

    await getLogs({ address, fromBlock: 0n, toBlock: 900n });

    expect(fallback).toHaveBeenCalledWith({ address, fromBlock: 801n, toBlock: 900n });
  });

  it('fetches only past saga coverage, up to the sync head', async () => {
    const { getLogs, fallback } = await source();

    await getLogs({ address, fromBlock: 0n, toBlock: 1_200n });

    expect(fallback).toHaveBeenCalledWith({ address, fromBlock: 1_001n, toBlock: 1_200n });
  });

  it('starts the RPC tail at the requested block when that is later', async () => {
    const { getLogs, fallback } = await source();

    await getLogs({ address, fromBlock: 1_100n, toBlock: 1_200n });

    expect(fallback).toHaveBeenCalledWith({ address, fromBlock: 1_100n, toBlock: 1_200n });
  });

  it('does not touch the RPC when saga covers the whole request', async () => {
    const { getLogs, fallback } = await source();

    await getLogs({ address, fromBlock: 0n, toBlock: 900n });

    expect(fallback).not.toHaveBeenCalled();
  });
});
