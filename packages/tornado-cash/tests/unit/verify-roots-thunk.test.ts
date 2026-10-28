import { computeMimcMerkleTreeRoot } from '@kohaku-eth/mimc-tree';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { IDepositEvent, IPool } from '../../src/data/interfaces/events.interface';
import type { Address, Commitment } from '../../src/interfaces/types.interface';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeFactory } from '../../src/state/store';
import { verifyRootsThunk } from '../../src/state/thunks/verifyRootsThunk';

const POOL_A = 1000n as Address;
const POOL_B = 2000n as Address;
const EMPTY_POOL = 3000n as Address;

function pool(address: Address): IPool {
  return {
    address,
    asset: 0n as Address,
    isERC20: false,
    protocolFeePercentage: 0,
    denomination: 10n ** 17n,
    registeredBlock: 0n,
    state: 1,
    rootHistorySize: 100,
  };
}

function deposit(poolAddress: Address, commitment: bigint, leafIndex: number): IDepositEvent {
  return {
    pool: poolAddress,
    commitment: commitment as Commitment,
    leafIndex,
    timestamp: 0n,
    blockNumber: BigInt(leafIndex + 1),
    transactionHash: commitment,
  };
}

function storeWithPools() {
  const store = storeFactory({
    protocolConfig: {
      chainId: 1n,
      ensSubdomainKey: 'eth',
      instanceRegistry: { address: 1n, deploymentBlock: 0n },
      relayerRegistry: { address: 2n, deploymentBlock: 0n },
      aggregator: { address: 3n },
    },
    logLevel: 'off',
  });

  store.dispatch(registerPools([pool(POOL_A), pool(POOL_B), pool(EMPTY_POOL)]));
  // Registered out of leafIndex order: the local tree must follow leafIndex.
  store.dispatch(registerDeposits([
    deposit(POOL_A, 30n, 2),
    deposit(POOL_A, 10n, 0),
    deposit(POOL_A, 20n, 1),
    deposit(POOL_B, 77n, 0),
  ]));

  return store;
}

// Roots from the single-threaded MiMC tree, independent of the worker-backed
// tree the thunk builds through the pool selectors.
const ROOT_A = computeMimcMerkleTreeRoot([10n, 20n, 30n]);
const ROOT_B = computeMimcMerkleTreeRoot([77n]);

function fakeDataService({
  currentRoots,
  knownRoots = new Map(),
}: {
  currentRoots: Map<Address, bigint>;
  knownRoots?: Map<Address, bigint[]>;
}) {
  const dataService = {
    getPoolStateRoot: vi.fn(async (address: Address) => currentRoots.get(address) ?? 1n),
    isPoolRootValid: vi.fn(async (address: Address, root: bigint) => (knownRoots.get(address) ?? []).includes(root)),
  };

  return { dataService, asService: dataService as unknown as IDataService };
}

describe('verifyRootsThunk', () => {
  beforeEach(() => {
    // poolMerkleTreeRootSelector logs tree build timings.
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts pools whose current on-chain root equals the locally rebuilt tree root', async () => {
    expect(ROOT_A).not.toBe(computeMimcMerkleTreeRoot([30n, 10n, 20n]));

    const store = storeWithPools();
    const { dataService, asService } = fakeDataService({
      currentRoots: new Map([[POOL_A, ROOT_A], [POOL_B, ROOT_B]]),
    });

    const action = await store.dispatch(verifyRootsThunk({ dataService: asService }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(dataService.getPoolStateRoot.mock.calls).toEqual([[POOL_A], [POOL_B]]);
    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('falls back to isKnownRoot with the local root when the pool has moved on', async () => {
    const store = storeWithPools();
    const { dataService, asService } = fakeDataService({
      currentRoots: new Map([[POOL_A, 5n], [POOL_B, 6n]]),
      knownRoots: new Map([[POOL_A, [ROOT_A]], [POOL_B, [ROOT_B]]]),
    });

    const action = await store.dispatch(verifyRootsThunk({ dataService: asService }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(dataService.isPoolRootValid.mock.calls).toEqual([[POOL_A, ROOT_A], [POOL_B, ROOT_B]]);
  });

  it('never queries pools without deposits, whose local root would be 0n', async () => {
    const store = storeWithPools();
    const { dataService, asService } = fakeDataService({
      currentRoots: new Map([[POOL_A, ROOT_A], [POOL_B, ROOT_B]]),
    });

    const action = await store.dispatch(verifyRootsThunk({ dataService: asService }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(dataService.getPoolStateRoot).not.toHaveBeenCalledWith(EMPTY_POOL);
    expect(dataService.isPoolRootValid).not.toHaveBeenCalledWith(EMPTY_POOL, expect.anything());
  });

  it('rejects and stops when a pool does not know the local root', async () => {
    const store = storeWithPools();
    const { dataService, asService } = fakeDataService({
      currentRoots: new Map([[POOL_A, 5n], [POOL_B, ROOT_B]]),
      knownRoots: new Map([[POOL_A, [4n]]]),
    });

    const action = await store.dispatch(verifyRootsThunk({ dataService: asService }));

    expect(action.meta.requestStatus).toBe('rejected');
    expect('error' in action && action.error.message).toContain(
      `State root verification failed: root not found in Pool recent history (expected=${ROOT_A}, currentOnChain=5)`,
    );
    expect(dataService.getPoolStateRoot).not.toHaveBeenCalledWith(POOL_B);
  });

  it('rejects when the RPC fails instead of skipping the pool', async () => {
    const store = storeWithPools();
    const { dataService, asService } = fakeDataService({ currentRoots: new Map() });

    dataService.getPoolStateRoot.mockRejectedValueOnce(new Error('connection refused'));

    const action = await store.dispatch(verifyRootsThunk({ dataService: asService }));

    expect(action.meta.requestStatus).toBe('rejected');
    expect('error' in action && action.error.message).toBe('connection refused');
  });

  it('only verifies the requested pools and ignores unknown addresses', async () => {
    const store = storeWithPools();
    const { dataService, asService } = fakeDataService({
      currentRoots: new Map([[POOL_A, ROOT_A], [POOL_B, ROOT_B]]),
    });

    const action = await store.dispatch(verifyRootsThunk({
      dataService: asService,
      onlyThesePools: [POOL_B, 9999n as Address],
    }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(dataService.getPoolStateRoot.mock.calls).toEqual([[POOL_B]]);
  });
});
