import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { ISecretManager } from '../../account/keys';
import { RootState } from '../store';
import { syncPoolsThunk, SyncPoolsThunkParams } from './syncPoolsThunk';
import { syncAssetsThunk, SyncAssetsThunkParams } from './syncAssetsThunk';
import { setLastSyncedBlock } from '../slices/syncSlice';
import { syncEventsThunk, SyncEventsThunkParams } from './syncEventsThunk';
import { syncRelayersThunk } from './syncRelayersThunk';
import { verifyRootsThunk } from './verifyRootsThunk';
import { discoverUserEventsThunk } from './discoverUserEventsThunk';

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams {
  dataService: IDataService;
  relayerClient: IRelayerClient;
  secretManager: ISecretManager;
  verify?: boolean;
}

export const syncThunk = createAsyncThunk<void, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, secretManager, verify = true, ...params }, { dispatch }) => {

    unwrapResult(await dispatch(syncPoolsThunk({
      dataService,
    })));

    unwrapResult(await dispatch(syncRelayersThunk({ dataService })));

    const syncEventsResult = await dispatch(syncEventsThunk({ dataService, ...params }));

    const syncEventsLastBlock = unwrapResult(syncEventsResult);

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    unwrapResult(await dispatch(discoverUserEventsThunk({ secretManager })));

    if (verify) {
      const verifyResult = await dispatch(verifyRootsThunk({ dataService }));

      unwrapResult(verifyResult);
    }

    dispatch(setLastSyncedBlock(syncEventsLastBlock));
  }
);
