import { createAsyncThunk } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface.js';
import {
  verifyAspRootOnChain,
  verifyStateRootOnChain,
} from '../../verification/root-verification.js';
import { poolMerkleTreeRootSelector } from '../selectors/pools.selector.js';
import { aspSelector, entrypointInfoSelector, poolsLeavesSelector, poolsSelector } from '../selectors/slices.selectors.js';
import { RootState } from '../store.js';

export interface VerifyRootsThunkParams {
  dataService: IDataService;
}

export const verifyRootsThunk = createAsyncThunk<void, VerifyRootsThunkParams, { state: RootState }>(
  'sync/verifyRoots',
  async ({ dataService }, { getState }) => {
    const state = getState();
    const { entrypointAddress } = entrypointInfoSelector(state);
    const asp = aspSelector(state);
    const pools = poolsSelector(state);
    const poolsLeaves = poolsLeavesSelector(state);

    if (asp.aspTreeRoot && asp.aspTreeRoot !== 0n) {
      await verifyAspRootOnChain(dataService, entrypointAddress, asp.aspTreeRoot);
    }

    for (const [poolAddress] of pools) {
      const leavesMap = poolsLeaves.get(poolAddress);

      if (!leavesMap || leavesMap.size === 0) continue;

      const localRoot = poolMerkleTreeRootSelector(state, poolAddress);

      await verifyStateRootOnChain(dataService, poolAddress, localRoot);
    }
  }
);
