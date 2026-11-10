import { createAsyncThunk } from '@reduxjs/toolkit';

import { IDataService } from '../../data/interfaces/data.service.interface';
import { timestampAnchorsSelector } from '../selectors/history.selector';
import { selectLastSyncedBlock } from '../selectors/last-synced-block.selector';
import { entrypointInfoSelector } from '../selectors/slices.selectors';
import { registerTimestampAnchors } from '../slices/historyMetadataSlice';
import { RootState } from '../store';

export interface SyncHistoryTimestampsThunkParams {
  dataService: IDataService;
}

/**
 * Block spacing of the timestamp grid: 2^15 blocks, about 4.5 days at 12 s.
 * Interpolating inside one cell is off by the missed slots it holds: on
 * mainnet usually under a minute, at most a few.
 */
export const TIMESTAMP_GRID = 32768n;

// Headers fetched in parallel, to stay friendly with public RPCs.
const CONCURRENCY = 5;

/**
 * Fetches the timestamps history() interpolates event times from: one header at
 * every multiple of {@link TIMESTAMP_GRID} from the entrypoint's deployment to
 * the last synced head, plus the head itself. Which blocks are requested depends
 * only on the deployment, the head and what is already cached, never on the
 * user's events, so the RPC learns nothing the bulk sync did not already show.
 */
export const syncHistoryTimestampsThunk = createAsyncThunk<void, SyncHistoryTimestampsThunkParams, { state: RootState }>(
  'sync/historyTimestamps',
  async ({ dataService }, { dispatch, getState }) => {
    const state = getState();
    const { deploymentBlock } = entrypointInfoSelector(state);
    const head = selectLastSyncedBlock(state);
    const known = new Set(timestampAnchorsSelector(state).map(([blockNumber]) => blockNumber));
    const missing: bigint[] = [];

    for (let block = deploymentBlock - (deploymentBlock % TIMESTAMP_GRID); block < head; block += TIMESTAMP_GRID) {
      if (!known.has(block)) missing.push(block);
    }

    if (!known.has(head)) missing.push(head);

    // Stored batch by batch so an interrupted first run (~130 headers on mainnet) resumes.
    for (let start = 0; start < missing.length; start += CONCURRENCY) {
      const blocks = missing.slice(start, start + CONCURRENCY);
      const timestamps = await Promise.all(blocks.map((block) => dataService.getBlockTimestamp(block)));

      dispatch(registerTimestampAnchors({
        grid: TIMESTAMP_GRID,
        anchors: blocks.map((block, i): [bigint, bigint] => [block, timestamps[i]!]),
      }));
    }
  },
);
