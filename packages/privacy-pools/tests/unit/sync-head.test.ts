import { describe, expect, it, vi } from 'vitest';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { myDepositsWithAssetSelector } from '../../src/state/selectors/balance.selector';
import { selectLastSyncedBlock } from '../../src/state/selectors/last-synced-block.selector';
import { storeFactory } from '../../src/state/store';
import { syncThunk } from '../../src/state/thunks/syncThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const entrypoint = 900n as Address;
const pool = 1000n as Address;
const asset = 2000n as Address;
const user = 3000n as Address;
const myPrecommitment = 77n;

type ChainEvent = { blockNumber: bigint; transactionHash: bigint } & Record<string, unknown>;

// The chain as seen through eth_getLogs, per contract and event name.
const entrypointEvents: Record<string, ChainEvent[]> = {
  PoolRegistered: [{ pool, asset, scope: 1n, blockNumber: 100n, transactionHash: 0n }],
  PoolWindDown: [],
  RootUpdated: [],
  EntrypointDeposited: [
    { depositor: user, poolAddress: pool, commitment: 11n, blockNumber: 105n, transactionHash: 0n },
    { depositor: user, poolAddress: pool, commitment: 22n, blockNumber: 108n, transactionHash: 0n },
  ],
};
const poolEvents: Record<string, ChainEvent[]> = {
  PoolDeposited: [
    { depositor: user, commitment: 11n, label: 10n, value: 100n, precommitment: myPrecommitment, blockNumber: 105n, transactionHash: 0n },
    { depositor: user, commitment: 22n, label: 20n, value: 50n, precommitment: 88n, blockNumber: 108n, transactionHash: 0n },
  ],
  LeafInserted: [
    { index: 1n, commitment: 11n, root: 1n, blockNumber: 105n, transactionHash: 0n },
    { index: 2n, commitment: 22n, root: 2n, blockNumber: 108n, transactionHash: 0n },
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
  const head = () => heads[Math.min(call++, heads.length - 1)]!;
  const scan = (source: Record<string, ChainEvent[]>) =>
    vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock?: bigint }) => {
      const to = toBlock ?? head();
      const inRange = (e: ChainEvent) => e.blockNumber >= fromBlock && e.blockNumber <= to;

      return {
        ...Object.fromEntries(events.map((name) => [name, (source[name] ?? []).filter(inRange)])),
        fromBlock,
        toBlock: to,
      };
    });

  return {
    getBlockNumber: vi.fn(async () => head()),
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

const setupStore = () => storeFactory({
  logLevel: 'off',
  devOptions: TEST_STORE_DEV_OPTIONS,
  entrypointInfo: { chainId: 1n, entrypointAddress: entrypoint, deploymentBlock: 100n },
});

const sync = (store: ReturnType<typeof setupStore>, dataService: ReturnType<typeof advancingChainDataService>) =>
  store.dispatch(syncThunk({
    dataService: dataService as unknown as IDataService,
    secretManager,
    aspService: {} as IAspService,
    verify: false,
  })).unwrap();

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
});
