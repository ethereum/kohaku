import { poseidon } from 'maci-crypto/build/ts/hashing.js';
import { describe, expect, it, vi } from 'vitest';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { myDepositsWithAssetSelector } from '../../src/state/selectors/balance.selector';
import { selectLastSyncedBlock } from '../../src/state/selectors/last-synced-block.selector';
import { storeFactory } from '../../src/state/store';
import { discoverUserSecretsThunk } from '../../src/state/thunks/discoverUserSecretsThunk';
import { syncThunk } from '../../src/state/thunks/syncThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const entrypoint = 900n as Address;
const pool = 1000n as Address;
const asset = 2000n as Address;
const user = 3000n as Address;
const myPrecommitment = 77n;
// Commitments as the pool computes them: poseidon(value, label, precommitment).
const myCommitment = poseidon([100n, 10n, myPrecommitment]);
const otherCommitment = poseidon([50n, 20n, 88n]);

type ChainEvent = { blockNumber: bigint; transactionHash: bigint } & Record<string, unknown>;

// The chain as seen through eth_getLogs, per contract and event name.
const entrypointEvents: Record<string, ChainEvent[]> = {
  PoolRegistered: [{ pool, asset, scope: 1n, blockNumber: 100n, transactionHash: 0n }],
  PoolWindDown: [],
  RootUpdated: [],
  EntrypointDeposited: [
    { depositor: user, poolAddress: pool, commitment: myCommitment, blockNumber: 105n, transactionHash: 0n },
    { depositor: user, poolAddress: pool, commitment: otherCommitment, blockNumber: 108n, transactionHash: 0n },
  ],
};
const poolEvents: Record<string, ChainEvent[]> = {
  PoolDeposited: [
    { depositor: user, commitment: myCommitment, label: 10n, value: 100n, precommitment: myPrecommitment, blockNumber: 105n, transactionHash: 0n },
    { depositor: user, commitment: otherCommitment, label: 20n, value: 50n, precommitment: 88n, blockNumber: 108n, transactionHash: 0n },
  ],
  LeafInserted: [
    { index: 1n, commitment: myCommitment, root: 1n, blockNumber: 105n, transactionHash: 0n },
    { index: 2n, commitment: otherCommitment, root: 2n, blockNumber: 108n, transactionHash: 0n },
  ],
  Withdrawn: [],
  Ragequit: [],
};

/**
 * A data service on a chain that keeps producing blocks: every head lookup
 * (explicit, or implicit in a log scan without `toBlock`) sees a newer block.
 */
const advancingChainDataService = (heads: bigint[]) => {
  let call = 0;
  let current = 0n;
  const head = () => (current = heads[Math.min(call++, heads.length - 1)]!);
  const scan = (source: Record<string, ChainEvent[]>) =>
    vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock?: bigint }) => {
      const to = toBlock ?? head();

      // As geth and most providers do.
      if (fromBlock > to) throw new Error(`invalid block range ${fromBlock}-${to}`);

      const inRange = (e: ChainEvent) => e.blockNumber >= fromBlock && e.blockNumber <= to;

      return {
        ...Object.fromEntries(events.map((name) => [name, (source[name] ?? []).filter(inRange)])),
        fromBlock,
        toBlock: to,
      };
    });

  return {
    getBlockNumber: vi.fn(async () => head()),
    // Everything up to the head is final here: reorgs are covered by sync-reorg.test.ts.
    getFinalizedBlockNumber: vi.fn(async () => current),
    getEntrypointEvents: scan(entrypointEvents),
    getPoolEvents: scan(poolEvents),
    getAsset: vi.fn(async (address: Address) => ({ address, name: 'T', symbol: 'T', decimals: 18 })),
  };
};

const secretManager = {
  getDepositSecrets: async ({ depositIndex }: { depositIndex: number }) => ({
    nullifier: 1n,
    salt: 2n,
    precommitment: depositIndex === 0 ? myPrecommitment : 999n,
    nullifierHash: 5n,
  }),
} as unknown as ISecretManager;

const setupStore = (deploymentBlock = 100n) => storeFactory({
  logLevel: 'off',
  devOptions: TEST_STORE_DEV_OPTIONS,
  entrypointInfo: { chainId: 1n, entrypointAddress: entrypoint, deploymentBlock },
});

const sync = async (store: ReturnType<typeof setupStore>, dataService: ReturnType<typeof advancingChainDataService>) => {
  await store.dispatch(syncThunk({
    dataService: dataService as unknown as IDataService,
    aspService: {} as IAspService,
    verify: false,
  })).unwrap();
  await store.dispatch(discoverUserSecretsThunk({ secretManager })).unwrap();
};

describe('syncThunk head', () => {
  it('scans the entrypoint and every pool up to one head and saves that head', async () => {
    const store = setupStore();
    const dataService = advancingChainDataService([104n, 108n, 120n, 130n]);

    await sync(store, dataService);

    const [{ toBlock: entrypointTo }] = dataService.getEntrypointEvents.mock.calls[0]!;
    const [{ toBlock: poolTo }] = dataService.getPoolEvents.mock.calls[0]!;

    expect(entrypointTo).toBe(104n);
    expect(poolTo).toBe(104n);
    expect(selectLastSyncedBlock(store.getState())).toBe(104n);
  });

  it('does not lose an entrypoint deposit that lands while the sync is scanning', async () => {
    const store = setupStore();
    // The chain moves from 104 to 108 between the entrypoint scan and the pool scan.
    const dataService = advancingChainDataService([104n, 108n, 120n, 130n]);

    await sync(store, dataService);
    await sync(store, dataService);

    // The user's deposit at block 105 has both its pool and entrypoint events, so
    // it counts towards the balance.
    expect(myDepositsWithAssetSelector(store.getState()).has(myPrecommitment)).toBe(true);
  });

  it('fails the sync instead of skipping a pool whose scan failed', async () => {
    const store = setupStore();
    const dataService = advancingChainDataService([104n, 120n]);

    dataService.getPoolEvents.mockRejectedValueOnce(new Error('rpc down'));

    await expect(sync(store, dataService)).rejects.toThrow('rpc down');
    expect(store.getState().sync.lastSyncedBlock).toBe('0');

    await sync(store, dataService);

    expect(myDepositsWithAssetSelector(store.getState()).has(myPrecommitment)).toBe(true);
  });

  // Saved head 110, finalized 104: the deposits at 105 and 108 are the unfinalized
  // tail. A lagging head below the sync point, at it, or between it and the saved
  // head cannot scan that tail again, so pruning it would lose the deposit at 108.
  it.each([103n, 104n, 106n])('leaves the state alone on a lagging head %i and resumes once past it', async (laggingHead) => {
    const store = setupStore();
    const dataService = advancingChainDataService([110n, laggingHead, 120n]);

    dataService.getFinalizedBlockNumber.mockResolvedValueOnce(104n);
    await sync(store, dataService);

    const before = store.getState();
    const scans = dataService.getEntrypointEvents.mock.calls.length;

    await sync(store, dataService);

    expect(dataService.getEntrypointEvents.mock.calls.length).toBe(scans);
    expect(store.getState().sync).toEqual(before.sync);
    expect(store.getState().deposits).toEqual(before.deposits);

    await sync(store, dataService);

    const [{ fromBlock }] = dataService.getEntrypointEvents.mock.calls.at(-1)!;

    expect(fromBlock).toBe(104n);
    expect(selectLastSyncedBlock(store.getState())).toBe(120n);
    expect(myDepositsWithAssetSelector(store.getState()).has(myPrecommitment)).toBe(true);
  });

  it('scans a new pool from the cursor, not from a forged registration block', async () => {
    const store = setupStore(0n);
    const dataService = advancingChainDataService([120n]);
    const scanEntrypoint = dataService.getEntrypointEvents.getMockImplementation()!;

    // The source dates the registration after the pool's deposits at 105 and 108.
    dataService.getEntrypointEvents.mockImplementation(async (params) => {
      const result = await scanEntrypoint(params);
      const { PoolRegistered } = result as unknown as Record<string, ChainEvent[]>;

      return { ...result, PoolRegistered: PoolRegistered!.map((e) => ({ ...e, blockNumber: 110n })) };
    });

    await sync(store, dataService);

    const [{ fromBlock }] = dataService.getPoolEvents.mock.calls[0]!;

    expect(fromBlock).toBe(0n);
    expect(myDepositsWithAssetSelector(store.getState()).has(myPrecommitment)).toBe(true);
  });
});
