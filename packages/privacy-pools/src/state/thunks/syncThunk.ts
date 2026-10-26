import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { ISecretManager } from '../../account/keys';
import { selectLastSyncedBlock } from '../selectors/last-synced-block.selector';
import { RootState } from '../store';
import { registerEntrypointDeposits } from '../slices/entrypointDepositsSlice';
import { syncPoolsThunk, SyncPoolsThunkParams } from './syncPoolsThunk';
import { syncAssetsThunk, SyncAssetsThunkParams } from './syncAssetsThunk';
import { registerLastUpdateRootEvent } from '../slices/updateRootEventsSlice';
import { syncAspThunk, SyncAspThunkParams } from './syncAspThunk';
import { setLastSyncedBlock } from '../slices/syncSlice';
import { syncEventsThunk, SyncEventsThunkParams } from './syncEventsThunk';
import { entrypointInfoSelector } from '../selectors/slices.selectors';
import { verifyRootsThunk } from './verifyRootsThunk';
import { discoverUserSecretsThunk } from './discoverUserSecretsThunk';

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams,
  SyncAspThunkParams {
  dataService: IDataService;
  secretManager: ISecretManager;
  verify?: boolean;
}

export const syncThunk = createAsyncThunk<void, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, secretManager, verify = true, ...params }, { getState, dispatch }) => {
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

    unwrapResult(await dispatch(discoverUserSecretsThunk({ secretManager })));

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    unwrapResult(await dispatch(syncAspThunk({ ...params })));

    if (verify) {
      const verifyResult = await dispatch(verifyRootsThunk({ dataService }));

      unwrapResult(verifyResult);
    }

    // An RPC behind our sync point scans nothing; keep the point where it is.
    if (toBlock > fromBlock) {
      dispatch(setLastSyncedBlock(toBlock));
    }
  }
);
