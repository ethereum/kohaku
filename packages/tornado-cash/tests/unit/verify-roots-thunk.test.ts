import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { registerPoolLeaves } from '../../src/state/slices/poolLeavesSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeFactory } from '../../src/state/store';
import { verifyRootsThunk } from '../../src/state/thunks/verifyRootsThunk';
import { computeMerkleTreeRoot } from '../../src/utils/proof.util';
import {
  verifyAspRootOnChain,
  verifyStateRootOnChain,
} from '../../src/verification/root-verification.js';

vi.mock('../../src/verification/root-verification.js', () => ({
  verifyAspRootOnChain: vi.fn().mockResolvedValue(undefined),
  verifyStateRootOnChain: vi.fn().mockResolvedValue(undefined),
}));

describe('verifyRootsThunk', () => {
  const entrypointAddress = 900n as Address;
  const poolAddress = 1000n as Address;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies the ASP root and each pool root from the synced state', async () => {
    const dataService = {} as IDataService;
    const store = storeFactory({
      logLevel: 'off',
      entrypointInfo: {
        chainId: 1n,
        entrypointAddress,
        deploymentBlock: 0n,
      },
    });

    store.dispatch(registerAspTree({
      leaves: [44n, 55n],
      aspTreeRoot: 333n,
      blockNumber: 12n,
    }));

    store.dispatch(registerPools([{
      address: poolAddress,
      asset: 2000n as Address,
      scope: 3000n,
      registeredBlock: 0n,
      woundDownAtBlock: null,
    }]));

    store.dispatch(registerPoolLeaves({
      poolAddress,
      leaves: [
        {
          index: 2n,
          commitment: 30n,
          root: 999n,
          blockNumber: 3n,
          transactionHash: 13n,
        },
        {
          index: 0n,
          commitment: 10n,
          root: 999n,
          blockNumber: 1n,
          transactionHash: 11n,
        },
        {
          index: 1n,
          commitment: 20n,
          root: 999n,
          blockNumber: 2n,
          transactionHash: 12n,
        },
      ],
    }));

    const action = await store.dispatch(
      verifyRootsThunk({ dataService }),
    );

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(verifyAspRootOnChain).toHaveBeenCalledWith(
      dataService,
      entrypointAddress,
      333n,
    );
    expect(verifyStateRootOnChain).toHaveBeenCalledTimes(1);
    expect(verifyStateRootOnChain).toHaveBeenCalledWith(
      dataService,
      poolAddress,
      computeMerkleTreeRoot([10n, 20n, 30n]),
    );
  });

  it('skips verification when ASP root is zero and a pool has no leaves', async () => {
    const dataService = {} as IDataService;
    const store = storeFactory({
      logLevel: 'off',
      entrypointInfo: {
        chainId: 1n,
        entrypointAddress,
        deploymentBlock: 0n,
      },
    });

    store.dispatch(registerPools([{
      address: poolAddress,
      asset: 2000n as Address,
      scope: 3000n,
      registeredBlock: 0n,
      woundDownAtBlock: null,
    }]));

    const action = await store.dispatch(
      verifyRootsThunk({ dataService }),
    );

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(verifyAspRootOnChain).not.toHaveBeenCalled();
    expect(verifyStateRootOnChain).not.toHaveBeenCalled();
  });

  it('rejects when ASP root verification fails', async () => {
    const dataService = {} as IDataService;
    const store = storeFactory({
      logLevel: 'off',
      entrypointInfo: {
        chainId: 1n,
        entrypointAddress,
        deploymentBlock: 0n,
      },
    });

    store.dispatch(registerAspTree({
      leaves: [44n],
      aspTreeRoot: 333n,
      blockNumber: 12n,
    }));

    vi.mocked(verifyAspRootOnChain).mockRejectedValueOnce(
      new Error('ASP root verification failed'),
    );

    const action = await store.dispatch(
      verifyRootsThunk({ dataService }),
    );

    expect(action.meta.requestStatus).toBe('rejected');
    expect(verifyStateRootOnChain).not.toHaveBeenCalled();
  });

  it('rejects when pool state root verification fails', async () => {
    const dataService = {} as IDataService;
    const store = storeFactory({
      logLevel: 'off',
      entrypointInfo: {
        chainId: 1n,
        entrypointAddress,
        deploymentBlock: 0n,
      },
    });

    store.dispatch(registerPools([{
      address: poolAddress,
      asset: 2000n as Address,
      scope: 3000n,
      registeredBlock: 0n,
      woundDownAtBlock: null,
    }]));

    store.dispatch(registerPoolLeaves({
      poolAddress,
      leaves: [{
        index: 0n,
        commitment: 10n,
        root: 999n,
        blockNumber: 1n,
        transactionHash: 11n,
      }],
    }));

    vi.mocked(verifyStateRootOnChain).mockRejectedValueOnce(
      new Error('State root verification failed'),
    );

    const action = await store.dispatch(
      verifyRootsThunk({ dataService }),
    );

    expect(action.meta.requestStatus).toBe('rejected');
  });

  it('verifies each pool independently when multiple pools have leaves', async () => {
    const dataService = {} as IDataService;
    const poolAddress2 = 2000n as Address;
    const store = storeFactory({
      logLevel: 'off',
      entrypointInfo: {
        chainId: 1n,
        entrypointAddress,
        deploymentBlock: 0n,
      },
    });

    store.dispatch(registerPools([
      {
        address: poolAddress,
        asset: 2000n as Address,
        scope: 3000n,
        registeredBlock: 0n,
        woundDownAtBlock: null,
      },
      {
        address: poolAddress2,
        asset: 4000n as Address,
        scope: 5000n,
        registeredBlock: 0n,
        woundDownAtBlock: null,
      },
    ]));

    store.dispatch(registerPoolLeaves({
      poolAddress,
      leaves: [{
        index: 0n,
        commitment: 10n,
        root: 999n,
        blockNumber: 1n,
        transactionHash: 11n,
      }],
    }));

    store.dispatch(registerPoolLeaves({
      poolAddress: poolAddress2,
      leaves: [{
        index: 0n,
        commitment: 77n,
        root: 888n,
        blockNumber: 2n,
        transactionHash: 22n,
      }],
    }));

    const action = await store.dispatch(
      verifyRootsThunk({ dataService }),
    );

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(verifyStateRootOnChain).toHaveBeenCalledTimes(2);
    expect(verifyStateRootOnChain).toHaveBeenCalledWith(
      dataService,
      poolAddress,
      computeMerkleTreeRoot([10n]),
    );
    expect(verifyStateRootOnChain).toHaveBeenCalledWith(
      dataService,
      poolAddress2,
      computeMerkleTreeRoot([77n]),
    );
  });

  it('skips ASP but verifies pool when ASP root is zero and pool has leaves', async () => {
    const dataService = {} as IDataService;
    const store = storeFactory({
      logLevel: 'off',
      entrypointInfo: {
        chainId: 1n,
        entrypointAddress,
        deploymentBlock: 0n,
      },
    });

    store.dispatch(registerPools([{
      address: poolAddress,
      asset: 2000n as Address,
      scope: 3000n,
      registeredBlock: 0n,
      woundDownAtBlock: null,
    }]));

    store.dispatch(registerPoolLeaves({
      poolAddress,
      leaves: [{
        index: 0n,
        commitment: 10n,
        root: 999n,
        blockNumber: 1n,
        transactionHash: 11n,
      }],
    }));

    const action = await store.dispatch(
      verifyRootsThunk({ dataService }),
    );

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(verifyAspRootOnChain).not.toHaveBeenCalled();
    expect(verifyStateRootOnChain).toHaveBeenCalledTimes(1);
    expect(verifyStateRootOnChain).toHaveBeenCalledWith(
      dataService,
      poolAddress,
      computeMerkleTreeRoot([10n]),
    );
  });
});
