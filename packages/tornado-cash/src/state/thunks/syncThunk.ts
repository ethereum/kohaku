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
import { IPoolSyncFailure } from '../pool-sync-error';

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams {
  dataService: IDataService;
  syncService: ISyncService;
  relayerClient: IRelayerClient;
  secretManager: ISecretManager;
  signatureGapLimit?: number;
}

export interface SyncResult {
  /** Pools that could not be synced; empty when the sync is complete. */
  failures: IPoolSyncFailure[];
  /** Pools the sync covered, including those whose configuration could not be fetched. */
  totalPools: number;
}

/**
 * Resolves with the pools that failed to sync. The pools that synced keep their
 * progress, but the global cursor only advances once every pool has synced.
 */
export const syncThunk = createAsyncThunk<SyncResult, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, syncService, secretManager, signatureGapLimit, instances, ...params }, { dispatch }) => {

    const poolFailures = unwrapResult(await dispatch(syncPoolsThunk({
      dataService,
      syncService,
      instances,
    })));

    // Every pool's synced deposits are checked against its on-chain root before
    // they are stored (see syncEventsThunk), so there is no separate verify step.
    const syncEventsResult = await dispatch(syncEventsThunk({ syncService, dataService }));

    const { lastBlock: syncEventsLastBlock, poolCount, failures: eventFailures } = unwrapResult(syncEventsResult);

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    unwrapResult(await dispatch(discoverUserEventsThunk({ secretManager, gapLimit: signatureGapLimit })));

    const failures = [...poolFailures, ...eventFailures];
    const totalPools = poolCount + poolFailures.length;

    if (failures.length === 0) dispatch(setLastSyncedBlock(syncEventsLastBlock));

    return { failures, totalPools };
  }
);
