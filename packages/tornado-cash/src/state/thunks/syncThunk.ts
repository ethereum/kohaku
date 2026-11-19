import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { ISyncService } from '../../data/interfaces/sync.service.interface';
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { ISecretManager } from '../../account/keys';
import { RootState } from '../store';
import { syncPoolsThunk, SyncPoolsThunkParams } from './syncPoolsThunk';
import { syncAssetsThunk, SyncAssetsThunkParams } from './syncAssetsThunk';
import { setLastSyncedBlock } from '../slices/syncSlice';
import { syncEventsThunk, SyncEventsThunkParams } from './syncEventsThunk';
import { discoverUserEventsThunk } from './discoverUserEventsThunk';

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams {
  dataService: IDataService;
  syncService: ISyncService;
  relayerClient: IRelayerClient;
  secretManager: ISecretManager;
}

export const syncThunk = createAsyncThunk<void, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, syncService, secretManager, instances, ...params }, { dispatch }) => {

    unwrapResult(await dispatch(syncPoolsThunk({
      dataService,
      syncService,
      instances,
    })));

    // Every pool's synced deposits are checked against its on-chain root before
    // they are stored (see syncEventsThunk), so there is no separate verify step.
    const syncEventsResult = await dispatch(syncEventsThunk({ syncService, dataService }));

    const syncEventsLastBlock = unwrapResult(syncEventsResult);

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    unwrapResult(await dispatch(discoverUserEventsThunk({ secretManager })));

    dispatch(setLastSyncedBlock(syncEventsLastBlock));
  }
);
