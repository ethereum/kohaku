import { describe, expect, it, vi } from 'vitest';
import { toHex } from 'viem';
import type { ExternalRawEvent } from '@kohaku-eth/plugins';
import { SyncService } from '../../src/data/sync.service';
import type { ExternalSyncClient } from '../../src/data/interfaces/sync.service.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type {
  IRawDepositEvent,
  IRawWithdrawalEvent,
  IRelayerRegisteredEvent,
} from '../../src/data/interfaces/events.interface';
import type { Address } from '../../src/interfaces/types.interface';

const CHAIN_ID = 1n;
const POOL = 0xaan as Address;
const HEAD = 1_000n;

const deposit = (blockNumber: bigint): IRawDepositEvent => ({
  commitment: blockNumber,
  leafIndex: Number(blockNumber),
  timestamp: 0n,
  blockNumber,
  transactionHash: 0n,
});

const withdrawal = (blockNumber: bigint): IRawWithdrawalEvent => ({
  to: 0n,
  nullifierHash: blockNumber,
  relayer: 0n,
  fee: 0n,
  blockNumber,
  transactionHash: 0n,
});

const relayerRegistered = (blockNumber: bigint): IRelayerRegisteredEvent => ({
  relayer: blockNumber,
  ensName: `relayer-${blockNumber}`,
  relayerAddress: 0n,
  stakedAmount: 0n,
  blockNumber,
  transactionHash: 0n,
});

// A fake DataService: the chain path (getPoolEvents) tags events at the block it
// was asked to start from, so tests can prove which range came from the chain.
// The pool holds code from `deployedAt` onwards. A node behind an explicit
// query bound rejects it; an empty range reports `fromBlock - 1`, like EthClient.
const chainRange = (fromBlock: bigint, toBlock: bigint | undefined, rpcHead: bigint) => {
  const end = toBlock ?? rpcHead;

  if (end > rpcHead) throw new Error('query bound exceeds RPC head');

  return { empty: fromBlock > end, fromBlock, toBlock: fromBlock > end ? fromBlock - 1n : end };
};

const makeDataService = (deployedAt = 500n, rpcHead = HEAD) => {
  const getPoolEvents = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock?: bigint }) => {
    const range = chainRange(fromBlock, toBlock, rpcHead);

    return {
      Deposited: range.empty ? [] : [deposit(fromBlock)],
      Withdrawn: range.empty ? [] : [withdrawal(fromBlock)],
      fromBlock,
      toBlock: range.toBlock,
    };
  });

  const parsePoolEvents = vi.fn((events: ExternalRawEvent[]) => ({
    Deposited: events.map((e) => deposit(BigInt(e.blockNumber))),
    Withdrawn: [] as IRawWithdrawalEvent[],
  }));

  const getRelayerRegistryEvents = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock?: bigint }) => {
    const range = chainRange(fromBlock, toBlock, rpcHead);

    return {
      RelayerRegistered: range.empty ? [] : [relayerRegistered(fromBlock)],
      fromBlock,
      toBlock: range.toBlock,
    };
  });

  const parseRelayerRegistryEvents = vi.fn((events: ExternalRawEvent[]) => ({
    RelayerRegistered: events.map((e) => relayerRegistered(BigInt(e.blockNumber))),
  }));

  const getContractDeploymentBlock = vi.fn(async () => 42n);
  const isContractDeployedAt = vi.fn(async (_address: Address, block: bigint) => block >= deployedAt);

  return {
    getBlockNumber: vi.fn(async () => HEAD),
    getPoolEvents,
    parsePoolEvents,
    getRelayerRegistryEvents,
    parseRelayerRegistryEvents,
    getContractDeploymentBlock,
    isContractDeployedAt,
  } as unknown as IDataService & {
    getPoolEvents: typeof getPoolEvents;
    parsePoolEvents: typeof parsePoolEvents;
    getRelayerRegistryEvents: typeof getRelayerRegistryEvents;
    parseRelayerRegistryEvents: typeof parseRelayerRegistryEvents;
    getContractDeploymentBlock: typeof getContractDeploymentBlock;
    isContractDeployedAt: typeof isContractDeployedAt;
  };
};

const makeProvider = (
  coverage: bigint | null,
  events: ExternalRawEvent[] = [],
  firstBlock: bigint | null = 0n,
) => {
  const getEvents = vi.fn(async () => events);

  return {
    // Coverage methods throw (rather than return null) when the provider has no
    // data for the pool.
    lastCoveredBlock: vi.fn(async () => {
      if (coverage == null) throw new Error('no coverage');

      return toHex(coverage);
    }),
    firstCoveredBlock: vi.fn(async () => {
      if (firstBlock == null) throw new Error('no coverage');

      return toHex(firstBlock);
    }),
    getEvents,
  } as unknown as ExternalSyncClient & {
    getEvents: typeof getEvents;
    lastCoveredBlock: ReturnType<typeof vi.fn>;
    firstCoveredBlock: ReturnType<typeof vi.fn>;
  };
};

const rawAt = (block: bigint): ExternalRawEvent => ({
  contractAddress: '0x00000000000000000000000000000000000000aa',
  eventTopic: '0x',
  topics: ['0x'],
  data: '0x',
  blockNumber: `0x${block.toString(16)}`,
  logIndex: '0x0',
});

describe('SyncService.getPoolEvents', () => {
  it('uses the external provider for the bulk, then the chain for the tail', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(600n, [rawAt(200n), rawAt(300n)]);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const result = await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 100n });

    // External streamed within [fromBlock, coverage]
    expect(provider.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: toHex(CHAIN_ID),
        fromBlock: toHex(100n),
        toBlock: toHex(600n),
      }),
    );
    expect(dataService.parsePoolEvents).toHaveBeenCalledWith([rawAt(200n), rawAt(300n)]);
    // Chain tail resumes at coverage + 1
    expect(dataService.getPoolEvents).toHaveBeenCalledTimes(1);
    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ address: POOL, fromBlock: 601n }),
    );
    // Merged: external deposits (blocks 200, 300) + chain tail deposit (block 601)
    expect(result.Deposited.map((d) => d.blockNumber).sort()).toEqual([200n, 300n, 601n]);
    expect(result.toBlock).toBe(HEAD);
  });

  it('falls back to a chain-only fetch when the range is below the threshold', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(600n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    // head (1000) - fromBlock (950) = 50 < 100
    const result = await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 950n });

    expect(provider.lastCoveredBlock).not.toHaveBeenCalled();
    expect(provider.getEvents).not.toHaveBeenCalled();
    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 950n }),
    );
    expect(result.Deposited.map((d) => d.blockNumber)).toEqual([950n]);
    expect(result.toBlock).toBe(HEAD);
  });

  it('falls back to the chain when no external provider is configured', async () => {
    const dataService = makeDataService();
    const service = new SyncService({ dataService, minExternalSyncBlocksAmount: 100 });

    await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 100n });

    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n }),
    );
  });

  it('falls back to the chain when the provider has no coverage for the pool', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(null);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 100n });

    expect(provider.lastCoveredBlock).toHaveBeenCalled();
    expect(provider.getEvents).not.toHaveBeenCalled();
    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n }),
    );
  });

  it("backfills from the chain the blocks before the provider's first covered block", async () => {
    const dataService = makeDataService();
    // Pool deployed at 500, provider data only for [700, 900].
    const provider = makeProvider(900n, [rawAt(750n)], 700n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const result = await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 500n });

    expect(provider.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: toHex(700n), toBlock: toHex(900n) }),
    );
    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 500n, toBlock: 699n }),
    );
    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 901n }),
    );
    expect(result.Deposited.map((d) => d.blockNumber)).toEqual([500n, 750n, 901n]);
    expect(result.toBlock).toBe(HEAD);
  });

  it('falls back to the chain when the first covered block is unavailable', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(900n, [rawAt(750n)], null);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 100n });

    expect(provider.getEvents).not.toHaveBeenCalled();
    expect(dataService.getPoolEvents).toHaveBeenCalledTimes(1);
    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n }),
    );
  });

  it('falls back to the chain when the provider coverage is empty', async () => {
    const dataService = makeDataService();
    // First covered block past the last covered one: nothing to stream.
    const provider = makeProvider(900n, [], 950n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    await service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 100n });

    expect(provider.getEvents).not.toHaveBeenCalled();
    expect(dataService.getPoolEvents).toHaveBeenCalledTimes(1);
  });

  it('rejects when the tail node cannot serve the captured head', async () => {
    // Initial head 1000, provider coverage 900, tail node only at 850.
    const dataService = makeDataService(500n, 850n);
    const provider = makeProvider(900n, [rawAt(200n)]);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    await expect(service.getPoolEvents({ chainId: CHAIN_ID, address: POOL, fromBlock: 100n }))
      .rejects.toThrow('query bound exceeds RPC head');

    expect(dataService.getPoolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 901n, toBlock: HEAD }),
    );
  });
});

describe('SyncService.getRelayerRegistryEvents', () => {
  const REGISTRY = 0xbbn as Address;

  it('uses the external provider for the bulk, then the chain for the tail', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(600n, [rawAt(200n), rawAt(300n)]);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const result = await service.getRelayerRegistryEvents({
      chainId: CHAIN_ID,
      address: REGISTRY,
      fromBlock: 100n,
    });

    expect(provider.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: toHex(CHAIN_ID),
        fromBlock: toHex(100n),
        toBlock: toHex(600n),
      }),
    );
    expect(dataService.parseRelayerRegistryEvents).toHaveBeenCalledWith([rawAt(200n), rawAt(300n)]);
    expect(dataService.getRelayerRegistryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ address: REGISTRY, fromBlock: 601n }),
    );
    expect(result.RelayerRegistered.map((r) => r.blockNumber).sort()).toEqual([200n, 300n, 601n]);
    expect(result.toBlock).toBe(HEAD);
  });

  it('falls back to a chain-only fetch when no provider / no coverage', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(null);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const result = await service.getRelayerRegistryEvents({
      chainId: CHAIN_ID,
      address: REGISTRY,
      fromBlock: 100n,
    });

    expect(provider.getEvents).not.toHaveBeenCalled();
    expect(dataService.getRelayerRegistryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n }),
    );
    expect(result.RelayerRegistered.map((r) => r.blockNumber)).toEqual([100n]);
  });

  it("backfills before the provider's coverage but rejects an unavailable tail", async () => {
    // Provider data only for [700, 900]; tail node only at 850.
    const dataService = makeDataService(500n, 850n);
    const provider = makeProvider(900n, [rawAt(750n)], 700n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    await expect(service.getRelayerRegistryEvents({
      chainId: CHAIN_ID,
      address: REGISTRY,
      fromBlock: 500n,
    })).rejects.toThrow('query bound exceeds RPC head');

    expect(dataService.getRelayerRegistryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 500n, toBlock: 699n }),
    );
    expect(dataService.getRelayerRegistryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 901n, toBlock: HEAD }),
    );
  });
});

describe('SyncService.getPoolDeploymentBlock', () => {
  it("uses the provider's first covered block once verified as a lower bound", async () => {
    const dataService = makeDataService(500n);
    const provider = makeProvider(600n, [], 500n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(500n);
    expect(provider.firstCoveredBlock).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: toHex(CHAIN_ID) }),
    );
    expect(dataService.isContractDeployedAt).toHaveBeenCalledWith(POOL, 499n);
    expect(dataService.getContractDeploymentBlock).not.toHaveBeenCalled();
  });

  it('accepts a conservative hint below the deployment block', async () => {
    const dataService = makeDataService(500n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: makeProvider(600n, [], 300n),
      minExternalSyncBlocksAmount: 100,
    });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(300n);
    expect(dataService.getContractDeploymentBlock).not.toHaveBeenCalled();
  });

  it('rejects a hint past the deployment block and falls back to the on-chain search', async () => {
    const dataService = makeDataService(500n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: makeProvider(600n, [], 700n),
      minExternalSyncBlocksAmount: 100,
    });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(42n);
    expect(dataService.isContractDeployedAt).toHaveBeenCalledWith(POOL, 699n);
    expect(dataService.getContractDeploymentBlock).toHaveBeenCalledWith(POOL);
  });

  it('rejects a hint past the chain head and falls back to the on-chain search', async () => {
    const dataService = makeDataService(500n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: makeProvider(600n, [], HEAD + 1n),
      minExternalSyncBlocksAmount: 100,
    });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(42n);
    expect(dataService.isContractDeployedAt).not.toHaveBeenCalled();
    expect(dataService.getContractDeploymentBlock).toHaveBeenCalledWith(POOL);
  });

  it('falls back to the on-chain deployment block when the provider has no coverage', async () => {
    const dataService = makeDataService();
    const provider = makeProvider(600n, [], null); // firstCoveredBlock throws
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(42n);
    expect(dataService.getContractDeploymentBlock).toHaveBeenCalledWith(POOL);
  });

  it('falls back to the on-chain deployment block when no provider is configured', async () => {
    const dataService = makeDataService();
    const service = new SyncService({ dataService });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(42n);
    expect(dataService.getContractDeploymentBlock).toHaveBeenCalledWith(POOL);
  });
});
