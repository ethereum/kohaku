import type { TxLog } from '@kohaku-eth/provider';
import { decodeAbiParameters, encodeAbiParameters, encodeEventTopics, parseAbi, toEventSelector } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { GetLogsParams } from '../../src/data/eth-client';
import { createSagaLogSource } from '../../src/data/saga-log-source';

const SAGA_LAST = 1_000n;

// Events the mocked stream yields; empty unless a test fills it.
const { streamed } = vi.hoisted(() => ({ streamed: [] as { blockNumber: string }[] }));

// saga covers its pool up to SAGA_LAST and streams `streamed`.
vi.mock('@saga-sync/client', () => ({
  HttpStore: class {},
  isEntityRecord: () => false,
  Client: class {
    fetchManifest = async () => ({ lastCoveredBlock: () => SAGA_LAST });
    resolveProtocolId = async () => 'privacy-pools-test';
    async *streamEvents() {
      yield* streamed;
    }
  },
}));

const source = async (headBlock?: bigint) => {
  const fallback = vi.fn<(params: GetLogsParams) => Promise<TxLog[]>>(async () => []);
  const getLogs = await createSagaLogSource({ sourceUrl: 'https://saga.test', chainId: 1, headBlock, fallback });

  return { getLogs, fallback };
};

const address = '0x0000000000000000000000000000000000001000';
const depositedAbi = parseAbi([
  'event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitment)',
]);

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

describe('createSagaLogSource window', () => {
  // A non-leaf event (no Deposited/Withdrawn topic), so nothing is synthesized.
  const event = (blockNumber: bigint) => ({
    blockNumber: String(blockNumber),
    logIndex: '0',
    topics: ['0x' + '11'.repeat(32)],
    data: '0x',
  });

  it('drops streamed events past a headBlock clamp', async () => {
    // @saga-sync/client <=0.3.0 uses the window only to pick chunks, so one
    // straddling the clamp still yields its later events.
    streamed.splice(0, streamed.length, event(700n), event(800n), event(950n));

    const { getLogs } = await source(800n);
    const logs = await getLogs({ address, fromBlock: 0n, toBlock: 900n });

    streamed.length = 0;

    expect(logs.map(({ blockNumber }) => blockNumber)).toEqual([700n, 800n]);
  });

  it('returns only events from fromBlock, keeping global leaf indices', async () => {
    const deposited = (blockNumber: bigint, commitment: bigint) => ({
      ...event(blockNumber),
      topics: encodeEventTopics({ abi: depositedAbi, eventName: 'Deposited', args: { _depositor: address } }),
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [commitment, 0n, 0n, 0n],
      ),
    });

    // Already synced up to 150: re-sending 100 would e.g. roll a later RootUpdated back.
    streamed.splice(0, streamed.length, deposited(100n, 11n), event(120n), deposited(200n, 22n));

    const { getLogs } = await source();
    const logs = await getLogs({ address, fromBlock: 150n, toBlock: 900n });

    streamed.length = 0;

    const leaves = logs
      .filter(({ topics }) => topics[0] === toEventSelector('event LeafInserted(uint256 _index, uint256 _leaf, uint256 _root)'))
      .map(({ data }) => decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], data as `0x${string}`));

    expect(logs.every(({ blockNumber }) => blockNumber === 200n)).toBe(true);
    expect(leaves).toEqual([[2n, 22n, 0n]]);
  });
});
