import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTree } from '#merkle-tree';
import { TornadoCashConfigs } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { IDepositEvent, IPool } from '../../src/data/interfaces/events.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeFactory } from '../../src/state/store';
import { verifyRootsThunk } from '../../src/state/thunks/verifyRootsThunk';
import { verifyStateRootOnChain } from '../../src/verification/root-verification';

// Test the thunk's pool selection and root checks without starting hashing workers.
vi.mock('#merkle-tree', () => ({ buildTree: vi.fn(), generateMerkleProof: vi.fn() }));
vi.mock('../../src/verification/root-verification', () => ({ verifyStateRootOnChain: vi.fn() }));

const poolAddress = 1000n as Address;
const poolAddress2 = 2000n as Address;
const dataService = {} as IDataService;
const makeStore = () => storeFactory({ logLevel: 'off', protocolConfig: TornadoCashConfigs[1] });
const pool = (address: Address): IPool => ({
  address,
  asset: 0n,
  isERC20: false,
  denomination: 10n ** 18n,
  protocolFeePercentage: 0,
  registeredBlock: 0n,
  state: 1,
  rootHistorySize: 100,
});
const deposits = (address: Address, leaves: bigint[]): IDepositEvent[] => leaves.map((commitment, leafIndex) => ({
  pool: address,
  commitment,
  leafIndex,
  timestamp: 0n,
  blockNumber: BigInt(leafIndex + 1),
  transactionHash: 0n,
}));
const treeWithRoot = (root: string) => ({ root } as Awaited<ReturnType<typeof buildTree>>);

describe('verifyRootsThunk', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildTree).mockResolvedValue(treeWithRoot('999'));
    vi.mocked(verifyStateRootOnChain).mockResolvedValue(undefined);
  });

  it('verifies the root built from deposits in leaf-index order', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress)]));
    store.dispatch(registerDeposits(deposits(poolAddress, [10n, 20n, 30n]).reverse()));

    const action = await store.dispatch(verifyRootsThunk({ dataService }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(buildTree).toHaveBeenCalledExactlyOnceWith([10n, 20n, 30n]);
    expect(verifyStateRootOnChain).toHaveBeenCalledExactlyOnceWith({
      dataService,
      poolAddress,
      expectedRoot: 999n,
    });
  });

  it('skips pools without deposits', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress)]));

    const action = await store.dispatch(verifyRootsThunk({ dataService }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(buildTree).not.toHaveBeenCalled();
    expect(verifyStateRootOnChain).not.toHaveBeenCalled();
  });

  it('checks only the requested registered pools', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress), pool(poolAddress2)]));
    store.dispatch(registerDeposits([
      ...deposits(poolAddress, [10n]),
      ...deposits(poolAddress2, [20n]),
    ]));

    const action = await store.dispatch(verifyRootsThunk({
      dataService,
      onlyThesePools: [poolAddress2, 3000n as Address],
    }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(buildTree).toHaveBeenCalledExactlyOnceWith([20n]);
    expect(verifyStateRootOnChain).toHaveBeenCalledExactlyOnceWith({
      dataService,
      poolAddress: poolAddress2,
      expectedRoot: 999n,
    });
  });

  it('rejects when pool state root verification fails', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress)]));
    store.dispatch(registerDeposits(deposits(poolAddress, [10n])));
    vi.mocked(verifyStateRootOnChain).mockRejectedValueOnce(new Error('State root verification failed'));

    await expect(store.dispatch(verifyRootsThunk({ dataService })).unwrap())
      .rejects.toMatchObject({ message: 'State root verification failed' });
  });

  it('verifies each pool independently when multiple pools have deposits', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress), pool(poolAddress2)]));
    store.dispatch(registerDeposits([
      ...deposits(poolAddress, [10n]),
      ...deposits(poolAddress2, [20n]),
    ]));
    vi.mocked(buildTree)
      .mockResolvedValueOnce(treeWithRoot('999'))
      .mockResolvedValueOnce(treeWithRoot('888'));

    const action = await store.dispatch(verifyRootsThunk({ dataService }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(buildTree).toHaveBeenCalledTimes(2);
    expect(verifyStateRootOnChain).toHaveBeenCalledTimes(2);
    expect(verifyStateRootOnChain).toHaveBeenNthCalledWith(1, {
      dataService,
      poolAddress,
      expectedRoot: 999n,
    });
    expect(verifyStateRootOnChain).toHaveBeenNthCalledWith(2, {
      dataService,
      poolAddress: poolAddress2,
      expectedRoot: 888n,
    });
  });

  it('skips verification when the requested pool list is empty', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress)]));
    store.dispatch(registerDeposits(deposits(poolAddress, [10n])));

    const action = await store.dispatch(verifyRootsThunk({ dataService, onlyThesePools: [] }));

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(buildTree).not.toHaveBeenCalled();
    expect(verifyStateRootOnChain).not.toHaveBeenCalled();
  });
});
