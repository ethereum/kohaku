import { createAction, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface SyncState {
  /** The head the last sync scanned up to. */
  lastSyncedBlock: bigint;
  /**
   * The last block the last sync saw finalized. Everything after it may still be
   * reorged away, so each sync drops it and scans it again (see syncThunk).
   * Absent in states saved before it existed: lastSyncedBlock stands in for it.
   */
  finalizedBlock?: bigint;
}

type ActualSyncState = Serializable<SyncState>;

const initialState: ActualSyncState = {
  lastSyncedBlock: '0',
  finalizedBlock: '0',
};

/** Drops every record from a block after `payload`, for a rescan from there. */
export const pruneAfterBlock = createAction<bigint>('sync/pruneAfterBlock');

export const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setSyncedBlocks: (_state, { payload }: PayloadAction<{ head: bigint; finalized: bigint }>) => {
      return serialize({
        lastSyncedBlock: payload.head,
        finalizedBlock: payload.finalized,
      });
    },
  },
});

export const { setSyncedBlocks } = syncSlice.actions;
export const syncReducer = syncSlice.reducer;
