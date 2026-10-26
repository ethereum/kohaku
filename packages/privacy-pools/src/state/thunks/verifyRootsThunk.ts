import { createAsyncThunk } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface.js';
import {
  verifyAspRootOnChain,
  verifyStateRootOnChain,
} from '../../verification/root-verification.js';
import { aspLeavesRootSelector } from '../selectors/merkle.selector.js';
import { poolMerkleTreeRootSelector } from '../selectors/pools.selector.js';
import { entrypointInfoSelector, poolsLeavesSelector, poolsSelector } from '../selectors/slices.selectors.js';
import { setVerifiedAspRoot } from '../slices/aspVerificationSlice.js';
import { RootState } from '../store.js';
import { Address } from '../../interfaces/types.interface.js';

export interface VerifyRootsThunkParams {
  dataService: IDataService;
}

export const verifyRootsThunk = createAsyncThunk<void, VerifyRootsThunkParams, { state: RootState }>(
  'sync/verifyRoots',
  async ({ dataService }, { getState, dispatch }) => {
    const state = getState();
    const { entrypointAddress } = entrypointInfoSelector(state);
    // Rebuilt from the synced leaves: the stored root is only what the service claimed.
    const aspRoot = aspLeavesRootSelector(state);
    const pools = poolsSelector(state);
    const poolsLeaves = poolsLeavesSelector(state);


    // Compute every leaf-bearing pool's local root (CPU-bound), collecting the
    // on-chain checks to run together afterwards.
    const stateRootChecks: Array<{ poolAddress: Address; localRoot: bigint }> = [];

    for (const [poolAddress] of pools) {
      const leavesMap = poolsLeaves.get(poolAddress);

      if (!leavesMap || leavesMap.size === 0) continue;

      const localRoot = poolMerkleTreeRootSelector(state, poolAddress);

      stateRootChecks.push({ poolAddress, localRoot });
    }


    // Proofs may only use an ASP root this session matched to the chain, so the
    // previous one is dropped until the check below passes again.
    dispatch(setVerifiedAspRoot(0n));

    // The Entrypoint ASP check and every pool state-root check are independent
    // reads — run them concurrently instead of awaiting one at a time.
    await Promise.all([
      ...(aspRoot !== 0n
        ? [verifyAspRootOnChain(dataService, entrypointAddress, aspRoot)
          .then(() => { dispatch(setVerifiedAspRoot(aspRoot)); })]
        : []),
      ...stateRootChecks.map(({ poolAddress, localRoot }) =>
        verifyStateRootOnChain(dataService, poolAddress, localRoot)),
    ]);
  }
);
