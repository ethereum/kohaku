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
const makeDataService = () => {
  const getPoolEvents = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => ({
    Deposited: [deposit(fromBlock)],
    Withdrawn: [withdrawal(fromBlock)],
    fromBlock,
    toBlock: HEAD,
  }));

  const parsePoolEvents = vi.fn((events: ExternalRawEvent[]) => ({
    Deposited: events.map((e) => deposit(BigInt(e.blockNumber))),
    Withdrawn: [] as IRawWithdrawalEvent[],
  }));

  const getRelayerRegistryEvents = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => ({
    RelayerRegistered: [relayerRegistered(fromBlock)],
    fromBlock,
    toBlock: HEAD,
  }));

  const parseRelayerRegistryEvents = vi.fn((events: ExternalRawEvent[]) => ({
    RelayerRegistered: events.map((e) => relayerRegistered(BigInt(e.blockNumber))),
  }));

  const getContractDeploymentBlock = vi.fn(async () => 42n);

  return {
    getBlockNumber: vi.fn(async () => HEAD),
    getPoolEvents,
    parsePoolEvents,
    getRelayerRegistryEvents,
    parseRelayerRegistryEvents,
    getContractDeploymentBlock,
  } as unknown as IDataService & {
    getPoolEvents: typeof getPoolEvents;
    parsePoolEvents: typeof parsePoolEvents;
    getRelayerRegistryEvents: typeof getRelayerRegistryEvents;
    parseRelayerRegistryEvents: typeof parseRelayerRegistryEvents;
    getContractDeploymentBlock: typeof getContractDeploymentBlock;
  };
};

const makeProvider = (
  coverage: bigint | null,
  events: ExternalRawEvent[] = [],
  firstBlock: bigint | null = null,
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
});

describe('SyncService.getPoolDeploymentBlock', () => {
  it("uses the provider's first covered block, skipping the on-chain search", async () => {
    const dataService = makeDataService();
    const provider = makeProvider(600n, [], 12345n);
    const service = new SyncService({
      dataService,
      externalSyncProvider: provider,
      minExternalSyncBlocksAmount: 100,
    });

    const block = await service.getPoolDeploymentBlock({ chainId: CHAIN_ID, address: POOL });

    expect(block).toBe(12345n);
    expect(provider.firstCoveredBlock).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: toHex(CHAIN_ID) }),
    );
    expect(dataService.getContractDeploymentBlock).not.toHaveBeenCalled();
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
