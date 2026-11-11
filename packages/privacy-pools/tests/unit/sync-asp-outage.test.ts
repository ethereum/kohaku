import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager } from '../../src/account/keys';
import type { IAspService } from '../../src/data/asp.interface';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { IRootUpdatedEvent } from '../../src/data/interfaces/events.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { selectLastSyncedBlock } from '../../src/state/selectors/last-synced-block.selector';
import { aspSelector, verifiedAspRootSelector } from '../../src/state/selectors/slices.selectors';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { setVerifiedAspRoot } from '../../src/state/slices/aspVerificationSlice';
import { storeStateManager } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';
import { syncThunk } from '../../src/state/thunks/syncThunk';
import { computeMerkleTreeRoot, type MerkleTree } from '../../src/utils/proof.util';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';
import { createMockHost } from '../utils/mock-host';

const entrypointAddress = 900n as Address;

const oldLeaves = [10n, 20n];
const oldRoot = await computeMerkleTreeRoot(oldLeaves);
const newLeaves = [10n, 20n, 30n];
const newRoot = await computeMerkleTreeRoot(newLeaves);

const rootUpdated = (root: bigint, blockNumber: bigint): IRootUpdatedEvent => ({
  root, ipfsCID: 'cid', timestamp: 1n, blockNumber, transactionHash: 0n,
});

/** A chain with no pools, whose last RootUpdated event is `event`. */
const chainDataService = (event: IRootUpdatedEvent) => ({
  getChainId: vi.fn(async () => 1n),
  getBlockNumber: vi.fn(async () => 200n),
  getEntrypointEvents: vi.fn(async ({ events, fromBlock, toBlock }: { events: string[]; fromBlock: bigint; toBlock: bigint }) => ({
    ...Object.fromEntries(events.map((name) => [name, []])),
    RootUpdated: [event],
    fromBlock,
    toBlock,
  })),
  getEntrypointLatestRoot: vi.fn(async () => event.root),
});

const secretManager = {
  getDepositSecrets: async () => ({ nullifier: 1n, salt: 2n, precommitment: 999n, nullifierHash: 5n }),
} as unknown as ISecretManager;

const downAsp = () => ({ getAspTree: vi.fn(async () => { throw new Error('gateway down'); }) }) satisfies IAspService;
const servingAsp = (leaves: bigint[]) => ({ getAspTree: vi.fn(async () => [leaves]) }) satisfies IAspService;

/** A store holding a good tree for `oldRoot`, verified earlier this session. */
const setupStore = () => {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress, deploymentBlock: 100n },
  });

  store.dispatch(registerAspTree({ leaves: oldLeaves, aspTreeRoot: oldRoot, blockNumber: 150n }));
  store.dispatch(setVerifiedAspRoot(oldRoot));

  return store;
};

const sync = (
  store: ReturnType<typeof setupStore>,
  dataService: ReturnType<typeof chainDataService>,
  aspService: IAspService,
  skipAsp?: boolean,
) => store.dispatch(syncThunk({
  dataService: dataService as unknown as IDataService,
  aspService,
  skipAsp,
})).unwrap();

describe('syncThunk with a failing ASP service', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the last good tree and still finishes the sync', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(newRoot, 180n));

    await sync(store, dataService, downAsp());

    expect(aspSelector(store.getState())).toEqual({ leaves: oldLeaves, aspTreeRoot: oldRoot, blockNumber: 150n });
    expect(selectLastSyncedBlock(store.getState())).toBe(200n);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('gateway down'));
  });

  it('leaves the ASP root unverified, so withdrawals are refused', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(newRoot, 180n));

    await sync(store, dataService, downAsp());

    expect(dataService.getEntrypointLatestRoot).not.toHaveBeenCalled();
    expect(verifiedAspRootSelector(store.getState())).toBe(0n);
  });

  it('keeps the last good tree when the service serves a tree that misses the root', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(newRoot, 180n));

    await sync(store, dataService, servingAsp([66n, 77n]));

    expect(aspSelector(store.getState()).leaves).toEqual(oldLeaves);
    expect(verifiedAspRootSelector(store.getState())).toBe(0n);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ASP tree root mismatch'));
  });

  it('recovers on the next sync once the service is back', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(newRoot, 180n));

    await sync(store, dataService, downAsp());
    await sync(store, dataService, servingAsp(newLeaves));

    expect(aspSelector(store.getState())).toEqual({ leaves: newLeaves, aspTreeRoot: newRoot, blockNumber: 180n });
    expect(verifiedAspRootSelector(store.getState())).toBe(newRoot);
  });

  it('finishes a first sync with no tree to fall back on', async () => {
    const store = storeFactory({
      logLevel: 'off',
      devOptions: TEST_STORE_DEV_OPTIONS,
      entrypointInfo: { chainId: 1n, entrypointAddress, deploymentBlock: 100n },
    });
    const dataService = chainDataService(rootUpdated(newRoot, 180n));

    await sync(store, dataService, downAsp());

    expect(aspSelector(store.getState()).leaves).toEqual([]);
    expect(selectLastSyncedBlock(store.getState())).toBe(200n);
  });

  it('still fails when a current tree does not match the chain', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(newRoot, 180n));

    dataService.getEntrypointLatestRoot.mockResolvedValue(123n);

    await expect(sync(store, dataService, servingAsp(newLeaves))).rejects.toThrow('ASP root verification failed');
    expect(verifiedAspRootSelector(store.getState())).toBe(0n);
  });
});

describe('syncThunk with skipAsp', () => {
  it('does not call the ASP service, and leaves a stale tree unverified', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(newRoot, 180n));
    const aspService = servingAsp(newLeaves);

    await sync(store, dataService, aspService, true);

    expect(aspService.getAspTree).not.toHaveBeenCalled();
    expect(aspSelector(store.getState()).leaves).toEqual(oldLeaves);
    expect(verifiedAspRootSelector(store.getState())).toBe(0n);
    expect(selectLastSyncedBlock(store.getState())).toBe(200n);
  });

  it('keeps a current tree verified', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(oldRoot, 150n));
    const aspService = servingAsp(oldLeaves);

    await sync(store, dataService, aspService, true);

    expect(aspService.getAspTree).not.toHaveBeenCalled();
    expect(verifiedAspRootSelector(store.getState())).toBe(oldRoot);
  });

  it('leaves the ASP root unverified when the custom builder disagrees with the stored root', async () => {
    const store = setupStore();
    const dataService = chainDataService(rootUpdated(oldRoot, 150n));
    const aspService = servingAsp(oldLeaves);
    const merkleTreeBuilder = vi.fn(async () => ({ root: 123n }) as MerkleTree);

    await store.dispatch(syncThunk({
      dataService: dataService as unknown as IDataService,
      aspService,
      skipAsp: true,
      merkleTreeBuilder,
    })).unwrap();

    expect(merkleTreeBuilder).toHaveBeenCalledWith(oldLeaves);
    expect(aspService.getAspTree).not.toHaveBeenCalled();
    expect(dataService.getEntrypointLatestRoot).not.toHaveBeenCalled();
    expect(verifiedAspRootSelector(store.getState())).toBe(0n);
    expect(selectLastSyncedBlock(store.getState())).toBe(200n);
  });
});

describe('storeStateManager.sync skipAsp queueing', () => {
  const asyncStorage = () => {
    const map = new Map<string, string>();

    return {
      _brand: 'Storage',
      get: async (key: string) => map.get(key) ?? null,
      set: async (key: string, value: string) => { map.set(key, value); },
    };
  };

  const setupManager = () => {
    const dataService = chainDataService(rootUpdated(newRoot, 180n));
    const aspService = servingAsp(newLeaves);
    const manager = storeStateManager({
      dataService: dataService as unknown as IDataService,
      secretManager,
      aspService,
      entrypoint: { address: entrypointAddress, deploymentBlock: 100n },
      storageToSyncTo: asyncStorage() as unknown as Storage,
      devOptions: TEST_STORE_DEV_OPTIONS,
    } as never);

    return { manager, aspService };
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('runs a follow-up without the ASP when every waiting call skips it', async () => {
    const { manager, aspService } = setupManager();
    const first = manager.sync({ skipAsp: true });

    await flush();
    await Promise.all([first, manager.sync({ skipAsp: true }), manager.sync({ skipAsp: true })]);

    expect(aspService.getAspTree).not.toHaveBeenCalled();
  });

  it.each([
    ['after', [{ skipAsp: true }, {}]],
    ['before', [{}, { skipAsp: true }]],
  ])('runs the ASP step when a call needing it joins %s a skipping call', async (_, followUps) => {
    const { manager, aspService } = setupManager();
    const first = manager.sync({ skipAsp: true });

    await flush();

    const pending = followUps.map((options) => manager.sync(options));

    await Promise.all([first, ...pending]);

    expect(aspService.getAspTree).toHaveBeenCalledTimes(1);
  });
});

describe('PrivacyPoolsV1Protocol sync options', () => {
  const stateManager = {
    sync: vi.fn(async () => undefined),
    getRagequitByLabelPayloads: vi.fn(async () => []),
  } as unknown as IStateManager;
  const protocol = new PrivacyPoolsV1Protocol(createMockHost(), {
    entrypoint: { address: entrypointAddress, deploymentBlock: 100n },
    stateManager: () => stateManager,
  });

  it('ragequit skips the ASP step', async () => {
    await protocol.ragequit([20n]);

    expect(stateManager.sync).toHaveBeenCalledWith({ skipAsp: true });
  });
});
