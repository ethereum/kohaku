import { createAsyncThunk } from '@reduxjs/toolkit';
import { IAspService } from '../../data/asp.service';
import { isAspRootUpToDateSelector } from '../selectors/asp.selector';
import { registerAspTree } from '../slices/aspSlice';
import { RootState } from '../store';
import { lastUpdateRootEventSelector } from '../selectors/slices.selectors';

export interface SyncAspThunkParams {
  aspService: IAspService;
}

export const syncAspThunk = createAsyncThunk<void, SyncAspThunkParams, { state: RootState }>(
  'sync/asp',
  async ({ aspService }, { getState, dispatch }) => {
    const state = getState();
    const isAspRootUpToDate = isAspRootUpToDateSelector(state);

    if (isAspRootUpToDate) {
      return;
    }

    const lastUpdateRootEvent = lastUpdateRootEventSelector(state);

    if (!lastUpdateRootEvent) {
      return;
    }

    const aspTree = await aspService.getAspTree(lastUpdateRootEvent.ipfsCID);

    const [aspTreeRoot] = aspTree.at(-1) || [];

    if (aspTreeRoot !== lastUpdateRootEvent.root) {
      throw new Error('ASP tree root mismatch: stored root does not match the root from RootUpdated event');
    }

    const leaves = aspTree.at(0)!;

    dispatch(registerAspTree({
      leaves,
      aspTreeRoot,
      blockNumber: lastUpdateRootEvent.blockNumber,
    }));
  }
);
