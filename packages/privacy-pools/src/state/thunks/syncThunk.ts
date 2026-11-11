import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { selectLastSyncedBlock } from '../selectors/last-synced-block.selector';
import { RootState } from '../store';
import { registerEntrypointDeposits } from '../slices/entrypointDepositsSlice';
import { syncPoolsThunk, SyncPoolsThunkParams } from './syncPoolsThunk';
import { syncAssetsThunk, SyncAssetsThunkParams } from './syncAssetsThunk';
import { registerLastUpdateRootEvent } from '../slices/updateRootEventsSlice';
import { isAspTreeCurrent, syncAspThunk, SyncAspThunkParams } from './syncAspThunk';
import { setLastSyncedBlock } from '../slices/syncSlice';
import { syncEventsThunk, SyncEventsThunkParams } from './syncEventsThunk';
import { entrypointInfoSelector, lastUpdateRootEventSelector } from '../selectors/slices.selectors';
import { verifyRootsThunk } from './verifyRootsThunk';

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams,
  SyncAspThunkParams {
  dataService: IDataService;
  verify?: boolean;
  /** Leave the ASP service out of this sync, keeping the stored tree. */
  skipAsp?: boolean;
}

/**
 * Syncs everything that is the same for every account. An account finds its own
 * notes in the result with discoverUserSecretsThunk.
 */
export const syncThunk = createAsyncThunk<void, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, verify = true, skipAsp = false, ...params }, { getState, dispatch }) => {
    const state = getState();
    const { entrypointAddress } = entrypointInfoSelector(state);
    const fromBlock = selectLastSyncedBlock(state);
    // One head for the whole sync: the entrypoint and pool scans all stop at it and
    // it becomes the next sync point, so no block can fall between two scans.
    const toBlock = await dataService.getBlockNumber();

    const {
      EntrypointDeposited,
      RootUpdated,
      PoolRegistered: poolsRegistered,
      PoolWindDown: poolsWoundDown
    } = await dataService.getEntrypointEvents({
      events: [
        "EntrypointDeposited",
        "RootUpdated",
        "PoolRegistered",
        "PoolWindDown"
      ],
      fromBlock,
      toBlock,
      address: entrypointAddress,
    });

    unwrapResult(await dispatch(syncPoolsThunk({
      poolsRegistered,
      poolsWoundDown,
    })));

    if (EntrypointDeposited.length > 0) {
      dispatch(registerEntrypointDeposits(EntrypointDeposited));
    }

    if (RootUpdated.length) {
      dispatch(registerLastUpdateRootEvent(RootUpdated.at(-1)!));
    }

    unwrapResult(await dispatch(syncEventsThunk({ dataService, toBlock, ...params })));

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    if (!skipAsp) {
      // An unreachable or lying ASP service must not take the chain state down with
      // it: the last good tree stays, and the next sync tries again.
      const aspResult = await dispatch(syncAspThunk({ ...params }));

      if (syncAspThunk.rejected.match(aspResult)) {
        console.warn(`ASP sync failed, keeping the last good tree: ${aspResult.error.message}`);
      }
    }

    if (verify) {
      // A tree behind the last RootUpdated cannot match latestRoot(). Its check is
      // left out, so the verified root stays unset and withdrawals are refused.
      const hasRootEvent = lastUpdateRootEventSelector(getState()) !== undefined;
      const verifyAspRoot = !hasRootEvent || await isAspTreeCurrent(getState(), params.merkleTreeBuilder);
      const verifyResult = await dispatch(verifyRootsThunk({ dataService, verifyAspRoot, merkleTreeBuilder: params.merkleTreeBuilder }));

      unwrapResult(verifyResult);
    }

    // An RPC behind our sync point scans nothing; keep the point where it is.
    if (toBlock > fromBlock) {
      dispatch(setLastSyncedBlock(toBlock));
    }
  }
);
