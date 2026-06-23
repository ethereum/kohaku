import { createAsyncThunk } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface.js';
import {
  verifyStateRootOnChain,
} from '../../verification/root-verification.js';
import { poolMerkleTreeRootSelector } from '../selectors/pools.selector.js';
import { poolsSelector } from '../selectors/slices.selectors.js';
import { RootState } from '../store.js';
import { stateLeavesSelector } from '../selectors/merkle.selector.js';
import { Address } from '../../interfaces/types.interface.js';

export interface VerifyRootsThunkParams {
  dataService: IDataService;
  onlyThesePools?: Array<Address>;
}

export const verifyRootsThunk = createAsyncThunk<void, VerifyRootsThunkParams, { state: RootState }>(
  'sync/verifyRoots',
  async ({ dataService, onlyThesePools }, { getState }) => {
    const state = getState();
    const pools = poolsSelector(state);
    const selectedPools = onlyThesePools ?
      onlyThesePools
        .map((address) => pools.get(address)?.address)
        .filter((a) => a !== undefined) :
      [...pools.keys()]

    for (const poolAddress of selectedPools) {
      const poolLeaves = stateLeavesSelector(state, poolAddress);

      if (poolLeaves.length === 0) continue;

      const localRoot = await poolMerkleTreeRootSelector(state, poolAddress);

      await verifyStateRootOnChain({
        dataService,
        poolAddress,
        expectedRoot: localRoot,
      });
    }
  }
);
