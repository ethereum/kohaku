import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { RootState } from '../store';
import { syncPoolsThunk, SyncPoolsThunkParams } from './syncPoolsThunk';
import { syncAssetsThunk, SyncAssetsThunkParams } from './syncAssetsThunk';
import { setLastSyncedBlock } from '../slices/syncSlice';
import { syncEventsThunk, SyncEventsThunkParams } from './syncEventsThunk';
import { verifyRootsThunk } from './verifyRootsThunk';

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams {
  dataService: IDataService;
  verify?: boolean;
}

export const syncThunk = createAsyncThunk<void, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, verify = true, ...params }, { dispatch }) => {

    unwrapResult(await dispatch(syncPoolsThunk({
      dataService,
    })));

    const syncEventsResult = await dispatch(syncEventsThunk({ dataService, ...params }));

    const syncEventsLastBlock = unwrapResult(syncEventsResult);

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    if (verify) {
      const verifyResult = await dispatch(verifyRootsThunk({ dataService }));

      unwrapResult(verifyResult);
    }

    dispatch(setLastSyncedBlock(syncEventsLastBlock));
  }
);
