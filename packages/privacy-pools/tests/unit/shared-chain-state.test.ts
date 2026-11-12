import { describe, expect, it, vi } from 'vitest';
import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { getStoreStorageKey, sharedChainEntries } from '../../src/state/chain-state';
import { storeStateManager, StoreFactoryParams } from '../../src/state/state-manager';
import { getPPv1ChainStateKey, getPPv1TimestampsKey } from '../../src/state/storage-keys';
import { computeMerkleTreeRoot } from '../../src/utils/proof.util';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';
import { createMockHost } from '../utils/mock-host';

const entrypoint = { address: 900n as Address, deploymentBlock: 100n };
const chainInfo = { chainId: 1n, entrypoint };
const stateKey = getStoreStorageKey(chainInfo);
const savedStateKey = getPPv1ChainStateKey(1n, entrypoint.address);
const timestampsKey = getPPv1TimestampsKey(1n, entrypoint.address);
const pool = 1000n as Address;
const asset = 2000n as Address;
const depositor = 3000n as Address;

const ACCOUNT_A = 77n;
const ACCOUNT_B = 88n;
const ASP_LEAVES = [10n];

type ChainEvent = { blockNumber: bigint; transactionHash: bigint } & Record<string, unknown>;

const deposit = (precommitment: bigint, commitment: bigint, label: bigint, blockNumber: bigint): ChainEvent =>
  ({ depositor, commitment, label, value: 100n, precommitment, blockNumber, transactionHash: 0n });

const entrypointEvents: Record<string, ChainEvent[]> = {
  PoolRegistered: [{ pool, asset, scope: 1n, blockNumber: 100n, transactionHash: 0n }],
  PoolWindDown: [],
  RootUpdated: [],
  EntrypointDeposited: [
    { depositor, poolAddress: pool, commitment: 11n, blockNumber: 105n, transactionHash: 0n },
    { depositor, poolAddress: pool, commitment: 22n, blockNumber: 106n, transactionHash: 0n },
  ],
};
const poolEvents: Record<string, ChainEvent[]> = {
  PoolDeposited: [deposit(ACCOUNT_A, 11n, 10n, 105n), deposit(ACCOUNT_B, 22n, 20n, 106n)],
  LeafInserted: [
    { index: 1n, commitment: 11n, root: 1n, blockNumber: 105n, transactionHash: 0n },
    { index: 2n, commitment: 22n, root: 2n, blockNumber: 106n, transactionHash: 0n },
  ],
  Withdrawn: [],
  Ragequit: [],
};

// A deposit that lands after the first sync, at block 250.
const LATE_DEPOSIT = 99n;
const lateEntrypointEvents: Record<string, ChainEvent[]> = {
  EntrypointDeposited: [{ depositor, poolAddress: pool, commitment: 33n, blockNumber: 250n, transactionHash: 0n }],
};
const latePoolEvents: Record<string, ChainEvent[]> = {
  PoolDeposited: [deposit(LATE_DEPOSIT, 33n, 30n, 250n)],
  LeafInserted: [{ index: 3n, commitment: 33n, root: 3n, blockNumber: 250n, transactionHash: 0n }],
};

const setupDataService = async ({ aspRoot, late = false }: { aspRoot?: bigint; late?: boolean } = {}) => {
  const stateRoot = await computeMerkleTreeRoot([11n, 22n]);
  const withLate = (source: Record<string, ChainEvent[]>, extra: Record<string, ChainEvent[]>) =>
    late ? Object.fromEntries(Object.entries(source).map(([name, events]) => [name, [...events, ...(extra[name] ?? [])]])) : source;
  const scan = (source: Record<string, ChainEvent[]>) =>
    vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock: bigint }) => ({
      ...Object.fromEntries(events.map((name) => {
        const inRange = (source[name] ?? []).filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);

        if (name === 'RootUpdated' && aspRoot !== undefined && fromBlock <= 104n) {
          return [name, [{ root: aspRoot, ipfsCID: 'cid', timestamp: 0n, blockNumber: 104n, transactionHash: 0n }]];
        }

        return [name, inRange];
      })),
      fromBlock,
      toBlock,
    }));

  return {
    getChainId: vi.fn(async () => 1n),
    getBlockNumber: vi.fn(async () => 200n),
    getEntrypointEvents: scan(withLate(entrypointEvents, lateEntrypointEvents)),
    getPoolEvents: scan(withLate(poolEvents, latePoolEvents)),
    getAsset: vi.fn(async (address: Address) => ({ address, name: 'T', symbol: 'T', decimals: 18 })),
    getPoolStateRoot: vi.fn(async (): Promise<bigint> => stateRoot),
    getPoolCurrentRootIndex: vi.fn(async () => 0),
    getPoolHistoricalRoot: vi.fn(async () => 0n),
    getEntrypointLatestRoot: vi.fn(async (): Promise<bigint> => aspRoot ?? 0n),
    getBlockTimestamp: vi.fn(async (block: bigint) => block * 12n),
  };
};

type MockDataService = Awaited<ReturnType<typeof setupDataService>>;

const secretManagerFor = (myPrecommitment: bigint) => ({
  getDepositSecrets: async ({ depositIndex }: { depositIndex: number }) => ({
    nullifier: 1n,
    salt: 2n,
    precommitment: depositIndex === 0 ? myPrecommitment : 999n,
    nullifierHash: myPrecommitment + 1000n,
  }),
}) as unknown as ISecretManager;

const memoryStorage = () => {
  const map = new Map<string, string>();

  return {
    map,
    _brand: 'Storage',
    get: vi.fn(async (key: string) => map.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
  };
};

const setupAccount = (
  dataService: MockDataService,
  myPrecommitment: bigint,
  chainStorage?: ReturnType<typeof memoryStorage>,
  overrides: Partial<StoreFactoryParams> = {},
) => storeStateManager({
  dataService: dataService as unknown as IDataService,
  secretManager: secretManagerFor(myPrecommitment),
  aspService: { getAspTree: async () => [ASP_LEAVES] } as unknown as IAspService,
  entrypoint,
  devOptions: TEST_STORE_DEV_OPTIONS,
  chainStorage: chainStorage as unknown as Storage | undefined,
  ...overrides,
} as never);

const myPrecommitments = async (account: IStateManager) =>
  (await account.getNotes({})).map(({ precommitment }) => precommitment);

describe('shared chain state', () => {
  it('gives accounts the same chain state, not a copy of it', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    await a.sync();
    await b.sync();

    const [stateA, stateB] = [a.dumpState()[stateKey]!, b.dumpState()[stateKey]!];

    expect(stateA.deposits.depositsTuples).toHaveLength(2);
    expect(stateB.deposits).toBe(stateA.deposits);
    expect(stateB.poolsLeaves).toBe(stateA.poolsLeaves);
    expect(stateB.withdrawals).toBe(stateA.withdrawals);
  });

  it('keeps one copy per account without a shared chain state', async () => {
    const dataService = await setupDataService();
    const a = setupAccount(dataService, ACCOUNT_A);
    const b = setupAccount(dataService, ACCOUNT_B);

    await a.sync();
    await b.sync();

    expect(b.dumpState()[stateKey]!.deposits).not.toBe(a.dumpState()[stateKey]!.deposits);
    expect(b.dumpState()[stateKey]!.deposits).toEqual(a.dumpState()[stateKey]!.deposits);
  });

  it('keeps each account to its own notes', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    await Promise.all([a.sync(), b.sync()]);

    expect(await myPrecommitments(a)).toEqual([ACCOUNT_A]);
    expect(await myPrecommitments(b)).toEqual([ACCOUNT_B]);
  });

  it('never puts an account\'s secrets in the state it shares', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);

    await a.sync();

    const chainState = (await sharedChainEntries(shared as unknown as Storage).get(chainInfo, {})).getState();

    expect(chainState).not.toHaveProperty('userSecrets');
    expect(a.dumpState()[stateKey]).not.toHaveProperty('userSecrets');
    expect(a.dumpState()[stateKey]).not.toHaveProperty('timestamps');
  });

  it('shares one follow-up sync between accounts syncing at once', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const accounts = [ACCOUNT_A, ACCOUNT_B, 99n].map((p) => setupAccount(dataService, p, shared));

    await Promise.all(accounts.map((account) => account.sync()));

    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it('lets a later account continue from the shared sync point', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    await a.sync();
    dataService.getEntrypointEvents.mockClear();
    await b.sync();

    expect(dataService.getEntrypointEvents.mock.calls.map(([{ fromBlock }]) => fromBlock)).toEqual([200n]);
    expect(await myPrecommitments(b)).toEqual([ACCOUNT_B]);
  });

  it('saves the chain state to the chain storage, and nothing per account', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const [hostA, hostB] = [memoryStorage(), memoryStorage()];
    const initialState = vi.fn(async () => ({}));
    const a = setupAccount(dataService, ACCOUNT_A, shared, { storageToSyncTo: hostA as unknown as Storage, initialState });
    const b = setupAccount(dataService, ACCOUNT_B, shared, { storageToSyncTo: hostB as unknown as Storage, initialState });

    await Promise.all([a.sync(), b.sync()]);
    await Promise.all([a.getHistory({}), b.getHistory({})]);

    expect(initialState).toHaveBeenCalledTimes(1);
    expect(shared.get.mock.calls.filter(([key]) => key === savedStateKey)).toHaveLength(1);
    expect(JSON.parse(shared.map.get(savedStateKey)!)).not.toHaveProperty('aspVerification');
    expect([...shared.map.keys()].sort()).toEqual([savedStateKey, timestampsKey].sort());
    // Nothing is saved per account.
    expect(hostA.map.size).toBe(0);
    expect(hostB.map.size).toBe(0);
  });

  it('keeps accounts with different chain storages apart', async () => {
    const dataService = await setupDataService();
    const a = setupAccount(dataService, ACCOUNT_A, memoryStorage());
    const b = setupAccount(dataService, ACCOUNT_B, memoryStorage());

    await a.sync();
    await b.sync();

    expect(b.dumpState()[stateKey]!.deposits).not.toBe(a.dumpState()[stateKey]!.deposits);
    expect(dataService.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it('keeps entrypoints apart in one shared chain state', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const otherEntrypoint = { address: 901n as Address, deploymentBlock: 100n };
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const other = setupAccount(dataService, ACCOUNT_B, shared, { entrypoint: otherEntrypoint });

    await Promise.all([a.sync(), other.sync()]);

    const otherKey = getStoreStorageKey({ chainId: 1n, entrypoint: otherEntrypoint });

    expect(a.dumpState()[stateKey]!.entrypointInfo.entrypointAddress).not
      .toBe(other.dumpState()[otherKey]!.entrypointInfo.entrypointAddress);
  });

  it('shows accounts nothing from a sync that has not passed verification', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    await b.getNotes({});
    dataService.getPoolStateRoot.mockRejectedValueOnce(new Error('rpc down'));

    await expect(a.sync()).rejects.toThrow('rpc down');

    expect(b.dumpState()[stateKey]!.deposits.depositsTuples).toEqual([]);
    expect(await myPrecommitments(b)).toEqual([]);

    await b.sync();

    expect(await myPrecommitments(b)).toEqual([ACCOUNT_B]);
  });

  it('holds the verified ASP root steady while another account re-verifies it', async () => {
    const aspRoot = await computeMerkleTreeRoot(ASP_LEAVES);
    const dataService = await setupDataService({ aspRoot });
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    await a.sync();

    const entry = await sharedChainEntries(shared as unknown as Storage).get(chainInfo, {});
    const verifiedRoot = entry.getState().aspVerification.verifiedRoot;

    expect(BigInt(verifiedRoot)).toBe(aspRoot);

    let release!: (root: bigint) => void;

    dataService.getEntrypointLatestRoot.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const syncing = b.sync();

    await vi.waitFor(() => expect(release).toBeDefined());
    expect(entry.getState().aspVerification.verifiedRoot).toBe(verifiedRoot);

    release(aspRoot);
    await syncing;

    expect(entry.getState().aspVerification.verifiedRoot).toBe(verifiedRoot);
  });

  it('fetches the timestamps once for every account', async () => {
    const dataService = await setupDataService();
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    await a.sync();
    await a.getHistory({});

    const fetched = dataService.getBlockTimestamp.mock.calls.length;

    expect(fetched).toBeGreaterThan(0);
    expect(shared.set.mock.calls.filter(([key]) => key === timestampsKey)).toHaveLength(1);

    await b.sync();
    await b.getHistory({});
    await a.getHistory({});

    expect(dataService.getBlockTimestamp).toHaveBeenCalledTimes(fetched);
    // A refresh that fetched nothing writes nothing.
    expect(shared.set.mock.calls.filter(([key]) => key === timestampsKey)).toHaveLength(1);
    expect((await b.getHistory({})).map(({ blockNumber }) => blockNumber)).toEqual([106n]);
  });

  it('refreshes timestamps up to the verified head while another sync runs', async () => {
    const dataService = await setupDataService({ late: true });
    const shared = memoryStorage();
    const a = setupAccount(dataService, ACCOUNT_A, shared);
    const b = setupAccount(dataService, ACCOUNT_B, shared);

    dataService.getBlockNumber.mockResolvedValueOnce(200n);
    await a.sync();

    // The next sync reaches the late deposit at 250, then waits on root verification.
    let release!: (root: bigint) => void;

    dataService.getBlockNumber.mockResolvedValueOnce(300n);
    dataService.getPoolStateRoot.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const syncing = b.sync();

    await vi.waitFor(() => expect(release).toBeDefined());

    dataService.getBlockTimestamp.mockClear();
    await a.getHistory({});

    const requested = dataService.getBlockTimestamp.mock.calls.map(([block]) => block);

    expect(requested).toContain(200n);
    expect(requested).not.toContain(250n);
    expect(a.dumpState()[stateKey]!.deposits.depositsTuples).toHaveLength(2);

    release(await computeMerkleTreeRoot([11n, 22n, 33n]));
    await syncing;

    expect(a.dumpState()[stateKey]!.deposits.depositsTuples).toHaveLength(3);
    // The timestamps fetched during the sync survived its publish.
    expect(BigInt(a.dumpState()[stateKey]!.sync.lastSyncedBlock)).toBe(300n);
    expect((await sharedChainEntries(shared as unknown as Storage).get(chainInfo, {})).getState().timestamps.anchors
      .map(([block]) => BigInt(block))).toContain(200n);
  });

  it('is passed from the plugin to the state manager', () => {
    const chainStorage = memoryStorage() as unknown as Storage;
    const stateManager = vi.fn(() => ({}) as unknown as IStateManager);

    new PrivacyPoolsV1Protocol(createMockHost(), {
      entrypoint,
      dataService: {} as IDataService,
      chainStorage,
      stateManager,
    });

    expect(stateManager).toHaveBeenCalledWith(expect.objectContaining({ chainStorage }));
  });
});
